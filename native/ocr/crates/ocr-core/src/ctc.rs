//! 字典和 CTC 解码（官方的 CTCLabelDecode）。

/// 识别模型的类别表：0 号是 CTC 的 blank，中间是 dict.txt 的字，最后是空格（官方 use_space_char 默认开着）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dictionary {
    symbols: Vec<String>,
}

const SPACE: &str = " ";

impl Dictionary {
    /// 读 dict.txt：一行一个字。末尾的空行忽略；中间有空行说明文件坏了（类别号会错开），报错。
    pub fn parse(text: &str) -> Result<Self, String> {
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        let mut lines: Vec<&str> = text
            .split('\n')
            .map(|line| line.strip_suffix('\r').unwrap_or(line))
            .collect();
        if lines.last() == Some(&"") {
            lines.pop();
        }
        if lines.is_empty() {
            return Err("字典是空的".into());
        }
        if let Some(index) = lines.iter().position(|line| line.is_empty()) {
            return Err(format!("字典第 {} 行是空行", index + 1));
        }
        let mut symbols = Vec::with_capacity(lines.len() + 2);
        symbols.push(String::new());
        symbols.extend(lines.into_iter().map(str::to_owned));
        symbols.push(SPACE.to_owned());
        Ok(Self { symbols })
    }

    /// 模型输出应有的类别数：字数 + blank + 空格。
    pub fn class_count(&self) -> usize {
        self.symbols.len()
    }

    pub fn symbol(&self, class: usize) -> &str {
        &self.symbols[class]
    }
}

/// 一行文字的识别结果。
#[derive(Clone, Debug, PartialEq)]
pub struct Recognized {
    pub text: String,
    /// 保留下来的各时间步最大概率的平均值；没有识别出字时为 0。
    pub score: f32,
}

const BLANK: usize = 0;

/// 解码一行：每步取概率最大的类别 → 去掉和上一步相同的 → 去掉 blank。
/// `probabilities` 是 `steps × classes` 的 softmax 输出（按行排列）。
pub fn decode(
    probabilities: &[f32],
    steps: usize,
    classes: usize,
    dictionary: &Dictionary,
) -> Recognized {
    let mut text = String::new();
    let mut total = 0.0f32;
    let mut kept = 0usize;
    let mut previous: Option<usize> = None;
    for step in probabilities.chunks_exact(classes).take(steps) {
        // 并列时取第一个（和 numpy 的 argmax 一致）。
        let (class, probability) =
            step.iter()
                .copied()
                .enumerate()
                .fold(
                    (0, f32::MIN),
                    |best, (class, p)| if p > best.1 { (class, p) } else { best },
                );
        if class != BLANK && previous != Some(class) {
            text.push_str(dictionary.symbol(class));
            total += probability;
            kept += 1;
        }
        previous = Some(class);
    }
    let score = if kept == 0 { 0.0 } else { total / kept as f32 };
    Recognized { text, score }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dictionary() -> Dictionary {
        Dictionary::parse("A\n-\n1\n").unwrap()
    }

    /// 每步一个 one-hot 风格的概率行：最可能的类别给 `p`，其余平分剩下的。
    fn steps(classes_and_probabilities: &[(usize, f32)], classes: usize) -> Vec<f32> {
        classes_and_probabilities
            .iter()
            .flat_map(|&(class, p)| {
                (0..classes).map(move |c| {
                    if c == class {
                        p
                    } else {
                        (1.0 - p) / (classes - 1) as f32
                    }
                })
            })
            .collect()
    }

    #[test]
    fn adds_blank_first_and_space_last() {
        let dictionary = dictionary();
        assert_eq!(dictionary.class_count(), 5);
        assert_eq!(dictionary.symbol(0), "");
        assert_eq!(dictionary.symbol(1), "A");
        assert_eq!(dictionary.symbol(4), " ");
    }

    #[test]
    fn accepts_crlf_and_a_byte_order_mark() {
        assert_eq!(
            Dictionary::parse("\u{feff}A\r\n-\r\n1\r\n").unwrap(),
            dictionary()
        );
    }

    #[test]
    fn keeps_a_whitespace_character_as_a_symbol() {
        let dictionary = Dictionary::parse("A\n\u{3000}\n").unwrap();
        assert_eq!(dictionary.symbol(2), "\u{3000}");
    }

    #[test]
    fn rejects_empty_lines_that_would_shift_classes() {
        assert!(Dictionary::parse("").is_err());
        assert!(Dictionary::parse("A\n\n1\n").is_err());
    }

    #[test]
    fn collapses_repeats_and_drops_blanks() {
        // A A blank A - - 1 → "AA-1"：blank 隔开的两个 A 都保留。
        let classes = 5;
        let probabilities = steps(
            &[
                (1, 0.9),
                (1, 0.8),
                (0, 0.99),
                (1, 0.7),
                (2, 0.6),
                (2, 0.5),
                (3, 0.4),
            ],
            classes,
        );
        let result = decode(&probabilities, 7, classes, &dictionary());
        assert_eq!(result.text, "AA-1");
        // 保留下来的是第 1、4、5、7 步：(0.9 + 0.7 + 0.6 + 0.4) / 4。
        assert!((result.score - 0.65).abs() < 1e-6);
    }

    #[test]
    fn scores_zero_when_nothing_was_read() {
        let classes = 5;
        let probabilities = steps(&[(0, 0.9), (0, 0.9)], classes);
        assert_eq!(
            decode(&probabilities, 2, classes, &dictionary()),
            Recognized {
                text: String::new(),
                score: 0.0
            }
        );
    }

    #[test]
    fn reads_the_trailing_space_class() {
        let classes = 5;
        let probabilities = steps(&[(1, 0.9), (4, 0.9), (3, 0.9)], classes);
        assert_eq!(
            decode(&probabilities, 3, classes, &dictionary()).text,
            "A 1"
        );
    }
}
