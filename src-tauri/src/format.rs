//! Number formatting for the tray title, tooltip and copied summary.
//! The panel UI has its own equivalent in `src/format.ts`.

const UNITS: [(f64, &str); 4] = [(1e3, "K"), (1e6, "M"), (1e9, "B"), (1e12, "T")];

/// 1234 → "1.2K", 10_112_582 → "10.1M", 999_999 → "1M".
pub fn compact(n: u64) -> String {
    let value = n as f64;
    let Some(mut idx) = UNITS.iter().rposition(|(limit, _)| value >= *limit) else {
        return n.to_string();
    };
    loop {
        let (limit, suffix) = UNITS.get(idx).copied().unwrap_or((1e12, "T"));
        let scaled = value / limit;
        // Rounding can push e.g. 999.96K to "1000K"; promote to the next unit instead.
        if scaled >= 999.95 && idx + 1 < UNITS.len() {
            idx += 1;
            continue;
        }
        let text = if scaled >= 100.0 { format!("{scaled:.0}") } else { format!("{scaled:.1}") };
        let text = text.strip_suffix(".0").unwrap_or(&text);
        return format!("{text}{suffix}");
    }
}

/// 10112582 → "10,112,582".
pub fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// 11.342 → "$11.34", 1234.5 → "$1,235".
pub fn usd(n: f64) -> String {
    if !n.is_finite() {
        return "–".into();
    }
    let sign = if n < 0.0 { "-" } else { "" };
    let n = n.abs();
    if n >= 1000.0 {
        format!("{sign}${}", grouped(n.round() as u64))
    } else {
        format!("{sign}${n:.2}")
    }
}

pub fn percent(n: Option<f64>) -> String {
    n.filter(|n| n.is_finite()).map_or_else(|| "–".into(), |n| format!("{n:.1}%"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_numbers() {
        assert_eq!(compact(0), "0");
        assert_eq!(compact(999), "999");
        assert_eq!(compact(1000), "1K");
        assert_eq!(compact(1234), "1.2K");
        assert_eq!(compact(10_112_582), "10.1M");
        assert_eq!(compact(245_000_000), "245M");
        assert_eq!(compact(999_999), "1M");
        assert_eq!(compact(u64::MAX), "18446744T");
    }

    #[test]
    fn grouping_and_money() {
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(1000), "1,000");
        assert_eq!(grouped(10_112_582), "10,112,582");
        assert_eq!(usd(11.342), "$11.34");
        assert_eq!(usd(1234.5), "$1,235");
        assert_eq!(usd(-2.5), "-$2.50");
        assert_eq!(usd(f64::NAN), "–");
        assert_eq!(percent(Some(3.587)), "3.6%");
        assert_eq!(percent(None), "–");
    }
}
