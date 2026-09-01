# Date handling in JavaScript: a real-life benchmark

Native `Date` vs a purpose-built minimal library (`chronoFast`) vs native `Temporal` vs the two Temporal polyfills, measured on both Node and Bun.

## Environment

| Runtime | Engine | Native `Temporal` | Contenders |
|---|---|---|---|
| Node 24.13.0 | V8 13.6.233.17 | no | 5 |
| Node 24.13.0 | V8 13.6.233.17 | yes | 5 |
| Bun 1.3.14 | JavaScriptCore | no | 5 |

- `temporal-polyfill` 1.0.4, `@js-temporal/polyfill` 0.5.1
- All timings are the **median** per-operation cost across many batched samples.
- A `×` figure under a number is how many times slower it is than the fastest entry in that row.

## Node 24 (default)


### Parsing

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 7.00M <sub>3.9×</sub> | **27.07M** | 26.01M <sub>1.0×</sub> | 354.9k <sub>76×</sub> | 491.6k <sub>55×</sub> |
| Parse ISO-8601 with UTC offset | 6.81M <sub>2.5×</sub> | 15.67M <sub>1.1×</sub> | **17.18M** | 294.1k <sub>58×</sub> | 362.8k <sub>47×</sub> |

### Formatting

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Format epoch ms to ISO-8601 UTC | 1.24M <sub>13×</sub> | **15.77M** | 12.26M <sub>1.3×</sub> | 323.4k <sub>49×</sub> | 179.0k <sub>88×</sub> |
| Format epoch ms to YYYY-MM-DD (UTC) | 1.91M <sub>12×</sub> | **22.92M** | &mdash; | 184.5k <sub>124×</sub> | 169.5k <sub>135×</sub> |

### Arithmetic (from epoch ms)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Add 7 days | 10.87M <sub>34×</sub> | **367.11M** | 173.88M <sub>2.1×</sub> | 113.8k <sub>3225×</sub> | 121.7k <sub>3017×</sub> |
| Add 1 month, end-of-month clamped | 3.96M <sub>7.8×</sub> | **30.76M** | 27.13M <sub>1.1×</sub> | 119.4k <sub>258×</sub> | 125.2k <sub>246×</sub> |
| Truncate to start of UTC day | 8.58M <sub>11×</sub> | **90.40M** | 72.43M <sub>1.2×</sub> | 130.6k <sub>692×</sub> | 162.3k <sub>557×</sub> |
| Whole calendar days between two instants | 4.41M <sub>61×</sub> | **269.04M** | &mdash; | 29.3k <sub>9197×</sub> | 70.3k <sub>3830×</sub> |

### Arithmetic (native object in)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Add 7 days to an existing instance | 11.61M <sub>28×</sub> | &mdash; | **321.54M** | 240.2k <sub>1339×</sub> | 134.0k <sub>2400×</sub> |
| Add 1 month to an existing instance | 4.33M <sub>7.0×</sub> | &mdash; | **30.53M** | 247.9k <sub>123×</sub> | 142.8k <sub>214×</sub> |

### Field access

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Read all six calendar fields | 8.13M <sub>4.9×</sub> | **39.92M** | &mdash; | 190.2k <sub>210×</sub> | 25.4k <sub>1573×</sub> |
| ISO day of week (1=Mon..7=Sun) | 13.57M <sub>16×</sub> | **217.32M** | &mdash; | 185.5k <sub>1172×</sub> | 212.5k <sub>1023×</sub> |
| ISO-8601 week number | 4.13M <sub>9.1×</sub> | **37.46M** | &mdash; | 156.6k <sub>239×</sub> | 186.5k <sub>201×</sub> |

### Bulk workloads

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Sort 2000 instants | 597 <sub>7.0×</sub> | **4.2k** | &mdash; | 1.9k <sub>2.2×</sub> | 32 <sub>132×</sub> |
| Pipeline: parse then +30 days then format | 1.34M <sub>7.2×</sub> | 9.04M <sub>1.1×</sub> | **9.58M** | 69.0k <sub>139×</sub> | 68.9k <sub>139×</sub> |
| Parse 10000 ISO strings and count per UTC day | 145 <sub>17×</sub> | **2.5k** | &mdash; | 11 <sub>218×</sub> | 13 <sub>195×</sub> |

### Timezone (Europe/Bratislava)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| UTC offset for an instant | 369.9k <sub>124×</sub> | **45.75M** | &mdash; | 151.1k <sub>303×</sub> | 242.6k <sub>189×</sub> |
| Format instant as local ISO with offset | 317.1k <sub>34×</sub> | **10.79M** | **10.79M** | 119.8k <sub>90×</sub> | 98.0k <sub>110×</sub> |
| Add 1 local day across DST | 114.1k <sub>139×</sub> | **15.83M** | 13.97M <sub>1.1×</sub> | 89.5k <sub>177×</sub> | 54.5k <sub>291×</sub> |
| Local midnight for an instant | 105.6k <sub>155×</sub> | **16.35M** | &mdash; | 88.5k <sub>185×</sub> | 61.4k <sub>266×</sub> |
| Bucket 10000 instants by LOCAL day | 34 <sub>261×</sub> | **8.9k** | &mdash; | 11 <sub>818×</sub> | 11 <sub>801×</sub> |

## Node 24 with --harmony-temporal

> `temporal-polyfill` v1 re-exports native `Temporal` when it exists (`TP.Temporal === globalThis.Temporal`), so it is listed once here, as **Temporal native**.


### Parsing

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 5.93M <sub>4.3×</sub> | 14.72M <sub>1.7×</sub> | **25.52M** | 2.73M <sub>9.3×</sub> | 510.6k <sub>50×</sub> |
| Parse ISO-8601 with UTC offset | 6.77M <sub>2.6×</sub> | **17.51M** | 17.14M <sub>1.0×</sub> | 2.15M <sub>8.1×</sub> | 351.8k <sub>50×</sub> |

### Formatting

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Format epoch ms to ISO-8601 UTC | 1.94M <sub>8.2×</sub> | **15.87M** | 12.74M <sub>1.2×</sub> | 701.0k <sub>23×</sub> | 177.6k <sub>89×</sub> |
| Format epoch ms to YYYY-MM-DD (UTC) | 1.91M <sub>12×</sub> | **23.07M** | &mdash; | 167.4k <sub>138×</sub> | 184.5k <sub>125×</sub> |

### Arithmetic (from epoch ms)

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Add 7 days | 10.69M <sub>34×</sub> | **364.70M** | 116.47M <sub>3.1×</sub> | 80.0k <sub>4559×</sub> | 122.4k <sub>2981×</sub> |
| Add 1 month, end-of-month clamped | 3.51M <sub>8.1×</sub> | **28.53M** | 27.59M <sub>1.0×</sub> | 143.5k <sub>199×</sub> | 119.3k <sub>239×</sub> |
| Truncate to start of UTC day | 8.80M <sub>11×</sub> | 92.90M <sub>1.0×</sub> | **94.09M** | 179.4k <sub>524×</sub> | 145.5k <sub>647×</sub> |
| Whole calendar days between two instants | 4.26M <sub>62×</sub> | **265.70M** | &mdash; | 56.8k <sub>4677×</sub> | 37.5k <sub>7086×</sub> |

### Arithmetic (native object in)

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Add 7 days to an existing instance | 6.92M <sub>26×</sub> | &mdash; | **182.56M** | 224.8k <sub>812×</sub> | 73.0k <sub>2501×</sub> |
| Add 1 month to an existing instance | 2.45M <sub>9.7×</sub> | &mdash; | **23.71M** | 312.9k <sub>76×</sub> | 138.5k <sub>171×</sub> |

### Field access

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Read all six calendar fields | 7.66M <sub>5.2×</sub> | **39.70M** | &mdash; | 147.0k <sub>270×</sub> | 45.4k <sub>875×</sub> |
| ISO day of week (1=Mon..7=Sun) | 21.04M <sub>9.4×</sub> | **198.59M** | &mdash; | 192.2k <sub>1033×</sub> | 226.7k <sub>876×</sub> |
| ISO-8601 week number | 4.12M <sub>8.3×</sub> | **33.98M** | &mdash; | 196.4k <sub>173×</sub> | 184.6k <sub>184×</sub> |

### Bulk workloads

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Sort 2000 instants | 580 <sub>6.9×</sub> | **4.0k** | &mdash; | 2.4k <sub>1.7×</sub> | 30 <sub>135×</sub> |
| Pipeline: parse then +30 days then format | 1.34M <sub>4.5×</sub> | **6.10M** | 5.61M <sub>1.1×</sub> | 103.3k <sub>59×</sub> | 52.4k <sub>116×</sub> |
| Parse 10000 ISO strings and count per UTC day | 88 <sub>15×</sub> | **1.3k** | &mdash; | 16 <sub>80×</sub> | 11 <sub>122×</sub> |

### Timezone (Europe/Bratislava)

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal |
|---|--:|--:|--:|--:|--:|
| UTC offset for an instant | 331.3k <sub>146×</sub> | **48.28M** | &mdash; | 7.2k <sub>6692×</sub> | 256.1k <sub>188×</sub> |
| Format instant as local ISO with offset | 313.3k <sub>35×</sub> | **10.91M** | 10.27M <sub>1.1×</sub> | 4.9k <sub>2237×</sub> | 96.9k <sub>113×</sub> |
| Add 1 local day across DST | 114.9k <sub>169×</sub> | **19.42M** | 13.89M <sub>1.4×</sub> | 3.1k <sub>6240×</sub> | 37.5k <sub>517×</sub> |
| Local midnight for an instant | 107.2k <sub>131×</sub> | **14.05M** | &mdash; | 4.9k <sub>2859×</sub> | 55.8k <sub>252×</sub> |
| Bucket 10000 instants by LOCAL day | 32 <sub>279×</sub> | **8.9k** | &mdash; | 0.69 <sub>12802×</sub> | 13 <sub>674×</sub> |

## Bun 1.3


### Parsing

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 5.92M <sub>6.1×</sub> | 35.24M <sub>1.0×</sub> | **36.15M** | 335.1k <sub>108×</sub> | 312.6k <sub>116×</sub> |
| Parse ISO-8601 with UTC offset | 5.25M <sub>4.3×</sub> | 22.51M <sub>1.0×</sub> | **22.76M** | 270.3k <sub>84×</sub> | 331.8k <sub>69×</sub> |

### Formatting

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Format epoch ms to ISO-8601 UTC | 6.09M <sub>1.4×</sub> | **8.76M** | 8.57M <sub>1.0×</sub> | 269.6k <sub>32×</sub> | 96.9k <sub>90×</sub> |
| Format epoch ms to YYYY-MM-DD (UTC) | 3.87M <sub>3.4×</sub> | **13.27M** | &mdash; | 111.5k <sub>119×</sub> | 101.1k <sub>131×</sub> |

### Arithmetic (from epoch ms)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Add 7 days | 10.00M <sub>24×</sub> | **244.09M** | 212.18M <sub>1.2×</sub> | 70.2k <sub>3479×</sub> | 62.4k <sub>3912×</sub> |
| Add 1 month, end-of-month clamped | 4.66M <sub>5.3×</sub> | **24.53M** | 23.92M <sub>1.0×</sub> | 64.9k <sub>378×</sub> | 95.7k <sub>256×</sub> |
| Truncate to start of UTC day | 9.15M <sub>26×</sub> | 173.43M <sub>1.3×</sub> | **233.38M** | 82.7k <sub>2822×</sub> | 99.7k <sub>2342×</sub> |
| Whole calendar days between two instants | 5.08M <sub>84×</sub> | **429.13M** | &mdash; | 18.6k <sub>23028×</sub> | 64.0k <sub>6703×</sub> |

### Arithmetic (native object in)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Add 7 days to an existing instance | 12.17M <sub>27×</sub> | &mdash; | **324.63M** | 208.1k <sub>1560×</sub> | 83.8k <sub>3872×</sub> |
| Add 1 month to an existing instance | 4.40M <sub>5.4×</sub> | &mdash; | **23.72M** | 203.2k <sub>117×</sub> | 124.3k <sub>191×</sub> |

### Field access

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Read all six calendar fields | 16.97M <sub>2.1×</sub> | **36.14M** | &mdash; | 123.1k <sub>293×</sub> | 25.5k <sub>1417×</sub> |
| ISO day of week (1=Mon..7=Sun) | 19.15M <sub>15×</sub> | **288.68M** | &mdash; | 188.2k <sub>1534×</sub> | 127.0k <sub>2273×</sub> |
| ISO-8601 week number | 5.02M <sub>7.1×</sub> | **35.79M** | &mdash; | 111.9k <sub>320×</sub> | 189.5k <sub>189×</sub> |

### Bulk workloads

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Sort 2000 instants | 394 <sub>7.4×</sub> | **2.9k** | &mdash; | 1.9k <sub>1.5×</sub> | 167 <sub>17×</sub> |
| Pipeline: parse then +30 days then format | 2.39M <sub>3.1×</sub> | **7.53M** | 7.32M <sub>1.0×</sub> | 64.8k <sub>116×</sub> | 63.8k <sub>118×</sub> |
| Parse 10000 ISO strings and count per UTC day | 183 <sub>13×</sub> | **2.3k** | &mdash; | 13 <sub>184×</sub> | 12 <sub>187×</sub> |

### Timezone (Europe/Bratislava)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| UTC offset for an instant | 337.1k <sub>204×</sub> | **68.76M** | &mdash; | 76.8k <sub>896×</sub> | 198.4k <sub>347×</sub> |
| Format instant as local ISO with offset | 421.9k <sub>15×</sub> | **6.53M** | 6.40M <sub>1.0×</sub> | 101.1k <sub>65×</sub> | 56.1k <sub>116×</sub> |
| Add 1 local day across DST | 157.7k <sub>88×</sub> | 12.58M <sub>1.1×</sub> | **13.83M** | 77.6k <sub>178×</sub> | 47.5k <sub>291×</sub> |
| Local midnight for an instant | 145.9k <sub>101×</sub> | **14.76M** | &mdash; | 75.3k <sub>196×</sub> | 48.6k <sub>304×</sub> |
| Bucket 10000 instants by LOCAL day | 42 <sub>114×</sub> | **4.7k** | &mdash; | 11 <sub>440×</sub> | 14 <sub>343×</sub> |

## Allocation pressure (approximate bytes per operation)

Measured on Node 24.13.0 by heap delta around short forced-GC windows. Directional, not exact — enough to separate "allocates nothing" from "allocates a dozen objects".

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 17 B | 17 B | 17 B | 7119 B | 2844 B |
| Parse ISO-8601 with UTC offset | 17 B | 17 B | 17 B | 8144 B | 3525 B |
| Format epoch ms to ISO-8601 UTC | 153 B | 57 B | 89 B | 8901 B | 5682 B |
| Format epoch ms to YYYY-MM-DD (UTC) | 185 B | 33 B | &mdash; | 15526 B | 5149 B |
| Add 7 days | 145 B | 17 B | 97 B | 23170 B | 8453 B |
| Add 1 month, end-of-month clamped | 241 B | 17 B | 97 B | 23438 B | 8213 B |
| Truncate to start of UTC day | 129 B | 17 B | 97 B | 21833 B | 5672 B |
| Whole calendar days between two instants | 256 B | 0 B | &mdash; | &mdash; | 15164 B |
| Add 7 days to an existing instance | 129 B | &mdash; | 16 B | 9958 B | 7290 B |
| Add 1 month to an existing instance | 225 B | &mdash; | 17 B | 9758 B | 7240 B |
| Read all six calendar fields | 129 B | 17 B | &mdash; | 14326 B | &mdash; |
| ISO day of week (1=Mon..7=Sun) | 113 B | 1 B | &mdash; | 13983 B | 3849 B |
| ISO-8601 week number | 353 B | 1 B | &mdash; | 14754 B | 6073 B |
| Pipeline: parse then +30 days then format | 153 B | 73 B | 137 B | 34502 B | 14780 B |
| UTC offset for an instant | 1054 B | 3 B | &mdash; | 17178 B | 3646 B |
| Format instant as local ISO with offset | 1769 B | 68 B | 108 B | 21015 B | 9016 B |
| Add 1 local day across DST | 3354 B | 40 B | 137 B | 27022 B | 17551 B |
| Local midnight for an instant | 3584 B | 40 B | &mdash; | 24712 B | 14617 B |

## Node vs Bun, same code

Ratio above 1 means Bun is faster.

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 0.85× | **1.30×** | **1.39×** | 0.94× | 0.64× |
| Parse ISO-8601 with UTC offset | 0.77× | **1.44×** | **1.33×** | 0.92× | 0.91× |
| Format epoch ms to ISO-8601 UTC | **4.91×** | 0.56× | 0.70× | 0.83× | 0.54× |
| Format epoch ms to YYYY-MM-DD (UTC) | **2.03×** | 0.58× | &mdash; | 0.60× | 0.60× |
| Add 7 days | 0.92× | 0.66× | **1.22×** | 0.62× | 0.51× |
| Add 1 month, end-of-month clamped | **1.18×** | 0.80× | 0.88× | 0.54× | 0.76× |
| Truncate to start of UTC day | **1.07×** | **1.92×** | **3.22×** | 0.63× | 0.61× |
| Whole calendar days between two instants | **1.15×** | **1.60×** | &mdash; | 0.64× | 0.91× |
| Add 7 days to an existing instance | **1.05×** | &mdash; | **1.01×** | 0.87× | 0.63× |
| Add 1 month to an existing instance | **1.02×** | &mdash; | 0.78× | 0.82× | 0.87× |
| Read all six calendar fields | **2.09×** | 0.91× | &mdash; | 0.65× | **1.00×** |
| ISO day of week (1=Mon..7=Sun) | **1.41×** | **1.33×** | &mdash; | **1.01×** | 0.60× |
| ISO-8601 week number | **1.22×** | 0.96× | &mdash; | 0.71× | **1.02×** |
| Sort 2000 instants | 0.66× | 0.69× | &mdash; | 0.99× | **5.27×** |
| Pipeline: parse then +30 days then format | **1.79×** | 0.83× | 0.76× | 0.94× | 0.93× |
| Parse 10000 ISO strings and count per UTC day | **1.26×** | 0.94× | &mdash; | **1.11×** | 0.98× |
| UTC offset for an instant | 0.91× | **1.50×** | &mdash; | 0.51× | 0.82× |
| Format instant as local ISO with offset | **1.33×** | 0.60× | 0.59× | 0.84× | 0.57× |
| Add 1 local day across DST | **1.38×** | 0.79× | 0.99× | 0.87× | 0.87× |
| Local midnight for an instant | **1.38×** | 0.90× | &mdash; | 0.85× | 0.79× |
| Bucket 10000 instants by LOCAL day | **1.22×** | 0.53× | &mdash; | 0.98× | **1.24×** |

## Per-operation median cost

<details><summary>Node 24 (default)</summary>

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 142.9 ns | 36.9 ns | 38.4 ns | 2.82 µs | 2.03 µs |
| Parse ISO-8601 with UTC offset | 146.8 ns | 63.8 ns | 58.2 ns | 3.40 µs | 2.76 µs |
| Format epoch ms to ISO-8601 UTC | 806.9 ns | 63.4 ns | 81.6 ns | 3.09 µs | 5.59 µs |
| Format epoch ms to YYYY-MM-DD (UTC) | 524.4 ns | 43.6 ns | &mdash; | 5.42 µs | 5.90 µs |
| Add 7 days | 92.0 ns | 2.7 ns | 5.8 ns | 8.78 µs | 8.22 µs |
| Add 1 month, end-of-month clamped | 252.8 ns | 32.5 ns | 36.9 ns | 8.38 µs | 7.99 µs |
| Truncate to start of UTC day | 116.6 ns | 11.1 ns | 13.8 ns | 7.66 µs | 6.16 µs |
| Whole calendar days between two instants | 226.6 ns | 3.7 ns | &mdash; | 34.19 µs | 14.23 µs |
| Add 7 days to an existing instance | 86.2 ns | &mdash; | 3.1 ns | 4.16 µs | 7.46 µs |
| Add 1 month to an existing instance | 230.9 ns | &mdash; | 32.8 ns | 4.03 µs | 7.00 µs |
| Read all six calendar fields | 123.0 ns | 25.1 ns | &mdash; | 5.26 µs | 39.41 µs |
| ISO day of week (1=Mon..7=Sun) | 73.7 ns | 4.6 ns | &mdash; | 5.39 µs | 4.71 µs |
| ISO-8601 week number | 242.2 ns | 26.7 ns | &mdash; | 6.39 µs | 5.36 µs |
| Sort 2000 instants | 1.67 ms | 238.73 µs | &mdash; | 528.30 µs | 31.51 ms |
| Pipeline: parse then +30 days then format | 746.0 ns | 110.6 ns | 104.3 ns | 14.50 µs | 14.52 µs |
| Parse 10000 ISO strings and count per UTC day | 6.90 ms | 403.50 µs | &mdash; | 87.98 ms | 78.62 ms |
| UTC offset for an instant | 2.70 µs | 21.9 ns | &mdash; | 6.62 µs | 4.12 µs |
| Format instant as local ISO with offset | 3.15 µs | 92.7 ns | 92.7 ns | 8.35 µs | 10.20 µs |
| Add 1 local day across DST | 8.76 µs | 63.2 ns | 71.6 ns | 11.17 µs | 18.35 µs |
| Local midnight for an instant | 9.47 µs | 61.2 ns | &mdash; | 11.30 µs | 16.29 µs |
| Bucket 10000 instants by LOCAL day | 29.16 ms | 111.74 µs | &mdash; | 91.36 ms | 89.49 ms |

</details>

<details><summary>Node 24 with --harmony-temporal</summary>

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 168.7 ns | 68.0 ns | 39.2 ns | 366.2 ns | 1.96 µs |
| Parse ISO-8601 with UTC offset | 147.8 ns | 57.1 ns | 58.3 ns | 464.8 ns | 2.84 µs |
| Format epoch ms to ISO-8601 UTC | 515.2 ns | 63.0 ns | 78.5 ns | 1.43 µs | 5.63 µs |
| Format epoch ms to YYYY-MM-DD (UTC) | 524.7 ns | 43.3 ns | &mdash; | 5.98 µs | 5.42 µs |
| Add 7 days | 93.5 ns | 2.7 ns | 8.6 ns | 12.50 µs | 8.17 µs |
| Add 1 month, end-of-month clamped | 285.3 ns | 35.1 ns | 36.2 ns | 6.97 µs | 8.38 µs |
| Truncate to start of UTC day | 113.6 ns | 10.8 ns | 10.6 ns | 5.57 µs | 6.87 µs |
| Whole calendar days between two instants | 234.9 ns | 3.8 ns | &mdash; | 17.60 µs | 26.67 µs |
| Add 7 days to an existing instance | 144.5 ns | &mdash; | 5.5 ns | 4.45 µs | 13.70 µs |
| Add 1 month to an existing instance | 407.6 ns | &mdash; | 42.2 ns | 3.20 µs | 7.22 µs |
| Read all six calendar fields | 130.6 ns | 25.2 ns | &mdash; | 6.80 µs | 22.04 µs |
| ISO day of week (1=Mon..7=Sun) | 47.5 ns | 5.0 ns | &mdash; | 5.20 µs | 4.41 µs |
| ISO-8601 week number | 243.0 ns | 29.4 ns | &mdash; | 5.09 µs | 5.42 µs |
| Sort 2000 instants | 1.72 ms | 248.68 µs | &mdash; | 417.43 µs | 33.67 ms |
| Pipeline: parse then +30 days then format | 745.2 ns | 164.0 ns | 178.1 ns | 9.68 µs | 19.07 µs |
| Parse 10000 ISO strings and count per UTC day | 11.43 ms | 772.10 µs | &mdash; | 61.44 ms | 94.01 ms |
| UTC offset for an instant | 3.02 µs | 20.7 ns | &mdash; | 138.62 µs | 3.90 µs |
| Format instant as local ISO with offset | 3.19 µs | 91.7 ns | 97.4 ns | 205.10 µs | 10.32 µs |
| Add 1 local day across DST | 8.70 µs | 51.5 ns | 72.0 ns | 321.35 µs | 26.63 µs |
| Local midnight for an instant | 9.33 µs | 71.2 ns | &mdash; | 203.47 µs | 17.94 µs |
| Bucket 10000 instants by LOCAL day | 31.36 ms | 112.41 µs | &mdash; | 1439.16 ms | 75.75 ms |

</details>

<details><summary>Bun 1.3</summary>

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal |
|---|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 169.0 ns | 28.4 ns | 27.7 ns | 2.98 µs | 3.20 µs |
| Parse ISO-8601 with UTC offset | 190.4 ns | 44.4 ns | 43.9 ns | 3.70 µs | 3.01 µs |
| Format epoch ms to ISO-8601 UTC | 164.3 ns | 114.2 ns | 116.7 ns | 3.71 µs | 10.32 µs |
| Format epoch ms to YYYY-MM-DD (UTC) | 258.5 ns | 75.3 ns | &mdash; | 8.97 µs | 9.89 µs |
| Add 7 days | 100.0 ns | 4.1 ns | 4.7 ns | 14.25 µs | 16.03 µs |
| Add 1 month, end-of-month clamped | 214.4 ns | 40.8 ns | 41.8 ns | 15.41 µs | 10.44 µs |
| Truncate to start of UTC day | 109.3 ns | 5.8 ns | 4.3 ns | 12.09 µs | 10.03 µs |
| Whole calendar days between two instants | 196.7 ns | 2.3 ns | &mdash; | 53.66 µs | 15.62 µs |
| Add 7 days to an existing instance | 82.2 ns | &mdash; | 3.1 ns | 4.80 µs | 11.93 µs |
| Add 1 month to an existing instance | 227.3 ns | &mdash; | 42.2 ns | 4.92 µs | 8.04 µs |
| Read all six calendar fields | 58.9 ns | 27.7 ns | &mdash; | 8.12 µs | 39.22 µs |
| ISO day of week (1=Mon..7=Sun) | 52.2 ns | 3.5 ns | &mdash; | 5.31 µs | 7.87 µs |
| ISO-8601 week number | 199.3 ns | 27.9 ns | &mdash; | 8.93 µs | 5.28 µs |
| Sort 2000 instants | 2.54 ms | 344.13 µs | &mdash; | 533.27 µs | 5.98 ms |
| Pipeline: parse then +30 days then format | 417.6 ns | 132.8 ns | 136.7 ns | 15.42 µs | 15.68 µs |
| Parse 10000 ISO strings and count per UTC day | 5.46 ms | 429.53 µs | &mdash; | 79.13 ms | 80.20 ms |
| UTC offset for an instant | 2.97 µs | 14.5 ns | &mdash; | 13.03 µs | 5.04 µs |
| Format instant as local ISO with offset | 2.37 µs | 153.3 ns | 156.3 ns | 9.89 µs | 17.83 µs |
| Add 1 local day across DST | 6.34 µs | 79.5 ns | 72.3 ns | 12.89 µs | 21.04 µs |
| Local midnight for an instant | 6.85 µs | 67.8 ns | &mdash; | 13.29 µs | 20.59 µs |
| Bucket 10000 instants by LOCAL day | 24.00 ms | 211.35 µs | &mdash; | 92.95 ms | 72.46 ms |

</details>
