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

static NSDictionary *perform(NSDictionary *input) {
    EKEventStore *store = [[EKEventStore alloc] init];
    NSString *operation = input[@"operation"];
    if ([operation isEqualToString:@"connect"]) {
        NSDictionary *error = requestAccess(store);
        if (error) return error;
    }
    if (!hasAccess()) return failure(@"Reminders access is unavailable. Connect in iNote Settings, or allow iNote in System Settings > Privacy & Security > Reminders.");

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
    if (!reminder) reminder = [EKReminder reminderWithEventStore:store];
    reminder.calendar = calendar;
    reminder.title = input[@"title"];
    reminder.URL = [NSURL URLWithString:marker];
    reminder.notes = input[@"notes"];
    reminder.priority = [input[@"priority"] unsignedIntegerValue];
    NSDate *due = [NSDate dateWithTimeIntervalSince1970:[input[@"dueTimestamp"] doubleValue]];
    NSCalendar *local = [NSCalendar currentCalendar];
    NSCalendarUnit units = NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay;
    if (![input[@"allDay"] boolValue]) units |= NSCalendarUnitHour | NSCalendarUnitMinute | NSCalendarUnitSecond;
    NSDateComponents *components = [local components:units fromDate:due];
    components.timeZone = local.timeZone;
    reminder.dueDateComponents = components;
    reminder.completed = [input[@"completed"] boolValue];
    reminder.alarms = @[];
    NSNumber *alarm = input[@"alarmTimestamp"];
    if (!reminder.completed && [alarm isKindOfClass:[NSNumber class]] && alarm.doubleValue > [NSDate date].timeIntervalSince1970) {
        [reminder addAlarm:[EKAlarm alarmWithAbsoluteDate:[NSDate dateWithTimeIntervalSince1970:alarm.doubleValue]]];
    }
    if (![store saveReminder:reminder commit:YES error:&error]) return failure(error.localizedDescription);
    return @{ @"identifier": reminder.calendarItemIdentifier };
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
