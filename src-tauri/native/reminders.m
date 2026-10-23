#import <Foundation/Foundation.h>
#import <EventKit/EventKit.h>
#include <stdlib.h>
#include <string.h>

// Called only on Tauri's blocking workers, never on the main/UI thread.
static NSDictionary *failure(NSString *message) {
    return @{ @"error": message ?: @"Reminders operation failed." };
}

static BOOL hasAccess(void) {
    EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeReminder];
    if (@available(macOS 14.0, *)) return status == EKAuthorizationStatusFullAccess;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    return status == EKAuthorizationStatusAuthorized;
#pragma clang diagnostic pop
}

static NSDictionary *requestAccess(EKEventStore *store) {
    if (hasAccess()) return nil;
    __block BOOL granted = NO;
    __block NSError *accessError = nil;
    dispatch_semaphore_t ready = dispatch_semaphore_create(0);
    void (^completion)(BOOL, NSError *) = ^(BOOL allowed, NSError *error) {
        granted = allowed;
        accessError = error;
        dispatch_semaphore_signal(ready);
    };
    if (@available(macOS 14.0, *)) {
        [store requestFullAccessToRemindersWithCompletion:completion];
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        [store requestAccessToEntityType:EKEntityTypeReminder completion:completion];
#pragma clang diagnostic pop
    }
    if (dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC))) {
        return failure(@"Authorization is still pending. Respond to the system prompt, then connect again.");
    }
    if (!granted) return failure(accessError.localizedDescription ?: @"Reminders access was denied. Allow iNote in System Settings > Privacy & Security > Reminders, then connect again.");
    [store reset];
    return nil;
}

static void (*changeCallback)(void) = NULL;
static EKEventStore *watchedStore;
static id changeObserver;

void inote_reminders_set_change_callback(void (*callback)(void)) { changeCallback = callback; }

static void ensureObserver(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (watchedStore) return;
        watchedStore = [[EKEventStore alloc] init];
        changeObserver = [[NSNotificationCenter defaultCenter] addObserverForName:EKEventStoreChangedNotification object:watchedStore queue:nil usingBlock:^(NSNotification *notification) {
            (void)notification;
            if (changeCallback) changeCallback();
        }];
    });
}

static NSDictionary *snapshot(EKReminder *reminder) {
    NSDateComponents *components = reminder.dueDateComponents;
    id due = [NSNull null];
    if (components) {
        BOOL allDay = components.hour == NSDateComponentUndefined;
        NSCalendar *calendar = [components.calendar copy] ?: [NSCalendar currentCalendar];
        calendar.timeZone = components.timeZone ?: [NSTimeZone localTimeZone];
        NSDate *date = [calendar dateFromComponents:components];
        if (date) {
            NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
            formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
            formatter.calendar = [[NSCalendar alloc] initWithCalendarIdentifier:NSCalendarIdentifierGregorian];
            formatter.timeZone = allDay ? calendar.timeZone : [NSTimeZone localTimeZone];
            formatter.dateFormat = allDay ? @"yyyy-MM-dd" : @"yyyy-MM-dd'T'HH:mm:ss";
            due = [formatter stringFromDate:date];
        } else { return failure(@"The system reminder has an invalid due date. Fix it in Reminders before syncing."); }
    }
    return @{ @"identifier": reminder.calendarItemIdentifier, @"due": due, @"completed": @(reminder.completed),
        @"modifiedAt": @((long long)(reminder.lastModifiedDate.timeIntervalSince1970 * 1000)) };
}

static NSDictionary *perform(NSDictionary *input) {
    EKEventStore *store = [[EKEventStore alloc] init];
    NSString *operation = input[@"operation"];
    if ([operation isEqualToString:@"connect"]) {
        NSDictionary *error = requestAccess(store);
        if (error) return error;
    }
    if (!hasAccess()) return failure(@"Reminders access is unavailable. Connect in iNote Settings, or allow iNote in System Settings > Privacy & Security > Reminders.");

    ensureObserver();
    if ([operation isEqualToString:@"connect"] || [operation isEqualToString:@"calendars"]) {
        NSMutableArray *calendars = [NSMutableArray array];
        for (EKCalendar *calendar in [store calendarsForEntityType:EKEntityTypeReminder]) {
            if (!calendar.allowsContentModifications) continue;
            [calendars addObject:@{ @"id": calendar.calendarIdentifier, @"title": calendar.title,
                @"source": calendar.source.title ?: @"" }];
        }
        NSString *defaultID = [store defaultCalendarForNewReminders].calendarIdentifier ?: @"";
        return @{ @"calendars": calendars, @"defaultCalendarId": defaultID };
    }

    NSString *marker = input[@"marker"];
    if (![marker hasPrefix:@"inote://reminder/"]) return failure(@"Invalid iNote reminder marker.");
    NSString *identifier = input[@"identifier"];
    EKCalendarItem *item = identifier.length ? [store calendarItemWithIdentifier:identifier] : nil;
    EKReminder *reminder = [item isKindOfClass:[EKReminder class]] && [item.URL.absoluteString isEqualToString:marker] ? (EKReminder *)item : nil;
    if (!reminder && ![input[@"recover"] isEqual:@NO]) {
        // Recover an item saved just before a crash, or whose identifier changed after sync.
        dispatch_semaphore_t ready = dispatch_semaphore_create(0);
        __block NSArray<EKReminder *> *matches = nil;
        NSPredicate *predicate = [store predicateForRemindersInCalendars:nil];
        id token = [store fetchRemindersMatchingPredicate:predicate completion:^(NSArray<EKReminder *> *items) {
            matches = items;
            dispatch_semaphore_signal(ready);
        }];
        if (dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC))) {
            [store cancelFetchRequest:token];
            return failure(@"Reading reminders timed out. Try syncing again.");
        }
        if (!matches) return failure(@"Could not read reminders. Try syncing again.");
        for (EKReminder *candidate in matches) {
            if ([candidate.URL.absoluteString isEqualToString:marker]) { reminder = candidate; break; }
        }
    }
    if ([operation isEqualToString:@"read"]) return reminder ? snapshot(reminder) : @{ @"missing": @YES };
    NSError *error = nil;
    if ([operation isEqualToString:@"remove"]) {
        if (reminder && ![store removeReminder:reminder commit:YES error:&error]) return failure(error.localizedDescription);
        return @{};
    }
    if (![operation isEqualToString:@"upsert"]) return failure(@"Unknown reminders operation.");
    EKCalendar *calendar = [store calendarWithIdentifier:input[@"calendarId"]];
    if (!calendar || !calendar.allowsContentModifications || !(calendar.allowedEntityTypes & EKEntityMaskReminder)) {
        return failure(@"The selected reminders list is missing or read-only. Choose another list in iNote Settings.");
    }
    NSDictionary *expected = input[@"expectedRemote"];
    if (([expected isKindOfClass:[NSDictionary class]] && (!reminder || ![snapshot(reminder) isEqualToDictionary:expected])) || ([input[@"expectedMissing"] boolValue] && reminder)) {
        return failure(@"The system reminder changed during sync. Retry to merge the latest version.");
    }
    if (!reminder) reminder = [EKReminder reminderWithEventStore:store];
    reminder.calendar = calendar;
    reminder.title = input[@"title"];
    reminder.URL = [NSURL URLWithString:marker];
    reminder.notes = input[@"notes"];
    reminder.priority = [input[@"priority"] unsignedIntegerValue];
    NSNumber *dueTimestamp = input[@"dueTimestamp"];
    if ([dueTimestamp isKindOfClass:[NSNumber class]]) {
        NSDate *due = [NSDate dateWithTimeIntervalSince1970:dueTimestamp.doubleValue];
        NSCalendar *local = [NSCalendar currentCalendar];
        NSCalendarUnit units = NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay;
        if (![input[@"allDay"] boolValue]) units |= NSCalendarUnitHour | NSCalendarUnitMinute | NSCalendarUnitSecond;
        NSDateComponents *components = [local components:units fromDate:due];
        components.timeZone = local.timeZone;
        reminder.dueDateComponents = components;
    } else {
        reminder.dueDateComponents = nil;
        reminder.startDateComponents = nil;
    }
    BOOL completed = [input[@"completed"] boolValue];
    if (reminder.completed != completed) reminder.completed = completed;
    reminder.alarms = @[];
    NSNumber *alarm = input[@"alarmTimestamp"];
    if (!reminder.completed && [alarm isKindOfClass:[NSNumber class]] && alarm.doubleValue > [NSDate date].timeIntervalSince1970) {
        [reminder addAlarm:[EKAlarm alarmWithAbsoluteDate:[NSDate dateWithTimeIntervalSince1970:alarm.doubleValue]]];
    }
    if (![store saveReminder:reminder commit:YES error:&error]) return failure(error.localizedDescription);
    return snapshot(reminder);
}

char *inote_reminders_call(const char *request) {
    @autoreleasepool {
        NSDictionary *result;
        @try {
            NSData *data = [NSData dataWithBytes:request length:strlen(request)];
            NSError *error = nil;
            id input = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
            result = [input isKindOfClass:[NSDictionary class]] ? perform(input) : failure(@"Invalid reminders request.");
        } @catch (NSException *exception) {
            result = failure(exception.reason);
        }
        NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
        NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        return strdup(json.UTF8String ?: "{\"error\":\"Could not encode reminders response.\"}");
    }
}

void inote_reminders_free(char *response) { free(response); }
