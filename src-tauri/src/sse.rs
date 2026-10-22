/// Decode complete SSE lines from bytes so UTF-8 characters may span network chunks.
#[derive(Default)]
pub struct SseDecoder {
    bytes: Vec<u8>,
    data: Vec<String>,
}

impl SseDecoder {
    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.bytes.extend_from_slice(chunk);
        let mut frames = Vec::new();
        while let Some(end) = self.bytes.iter().position(|byte| *byte == b'\n') {
            let line = self.bytes.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "LLM stream contains invalid UTF-8")?
                .trim_end_matches(['\r', '\n']);
            self.line(line, &mut frames);
        }
        if self.bytes.len() > 1024 * 1024
            || self.data.iter().map(String::len).sum::<usize>() > 1024 * 1024
        {
            return Err("LLM stream event exceeds the size limit".to_string());
        }
        Ok(frames)
    }

    fn line(&mut self, line: &str, frames: &mut Vec<String>) {
        if line.is_empty() {
            if !self.data.is_empty() {
                frames.push(self.data.join("\n"));
                self.data.clear();
            }
        } else if let Some(value) = line.strip_prefix("data:") {
            self.data
                .push(value.strip_prefix(' ').unwrap_or(value).to_string());
        }
    }

    pub fn finish(&mut self) -> Result<Vec<String>, String> {
        let remaining = std::mem::take(&mut self.bytes);
        let line =
            std::str::from_utf8(&remaining).map_err(|_| "LLM stream ended in incomplete UTF-8")?;
        let mut frames = Vec::new();
        if !line.is_empty() {
            self.line(line.trim_end_matches('\r'), &mut frames);
        }
        self.line("", &mut frames);
        Ok(frames)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_chinese_at_every_possible_chunk_boundary() {
        let message = "data: {\"text\":\"你好🌍\"}\r\n\r\n".as_bytes();
        for boundary in 0..=message.len() {
            let mut decoder = SseDecoder::default();
            let mut frames = decoder.feed(&message[..boundary]).unwrap();
            frames.extend(decoder.feed(&message[boundary..]).unwrap());
            frames.extend(decoder.finish().unwrap());
            assert_eq!(frames, ["{\"text\":\"你好🌍\"}"]);
        }
    }
    #[test]
    fn handles_comments_multiline_data_and_final_event_without_newline() {
        let mut decoder = SseDecoder::default();
        assert_eq!(
            decoder
                .feed(b":heartbeat\nevent: message\ndata:first\ndata: second\n\ndata: final")
                .unwrap(),
            ["first\nsecond"]
        );
        assert_eq!(decoder.finish().unwrap(), ["final"]);
    }
    #[test]
    fn rejects_incomplete_unicode_instead_of_replacing_it() {
        let mut decoder = SseDecoder::default();
        decoder.feed(&[b'd', b'a', b't', b'a', b':', 0xe4]).unwrap();
        assert!(decoder.finish().is_err());
    }
}
