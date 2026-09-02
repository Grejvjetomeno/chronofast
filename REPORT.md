# Date handling in JavaScript: a real-life benchmark

Native `Date` vs a purpose-built minimal library (`chronoFast`) vs native `Temporal` vs the two Temporal polyfills, measured on both Node and Bun.

## Environment

| Runtime | Engine | Native `Temporal` | Contenders |
|---|---|---|---|
| Node 24.13.0 | V8 13.6.233.17 | no | 6 |
| Node 24.13.0 | V8 13.6.233.17 | yes | 6 |
| Bun 1.3.14 | JavaScriptCore | no | 6 |

- `temporal-polyfill` 1.0.4, `@js-temporal/polyfill` 0.5.1
- All timings are the **median** per-operation cost across many batched samples.
- A `×` figure under a number is how many times slower it is than the fastest entry in that row.

## Node 24 (default)


### Parsing

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 7.60M <sub>3.7×</sub> | **28.23M** | 27.38M <sub>1.0×</sub> | 369.0k <sub>76×</sub> | 456.8k <sub>62×</sub> | 2.58M <sub>11×</sub> |
| Parse ISO-8601 with UTC offset | 6.89M <sub>2.6×</sub> | **17.86M** | 17.67M <sub>1.0×</sub> | 314.8k <sub>57×</sub> | 384.6k <sub>46×</sub> | 879.4k <sub>20×</sub> |

### Formatting

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Format epoch ms to ISO-8601 UTC | 1.97M <sub>8.3×</sub> | **16.41M** | 16.33M <sub>1.0×</sub> | 361.9k <sub>45×</sub> | 184.9k <sub>89×</sub> | 1.55M <sub>11×</sub> |
| Format epoch ms to YYYY-MM-DD (UTC) | 1.96M <sub>13×</sub> | **24.95M** | 23.99M <sub>1.0×</sub> | 197.3k <sub>126×</sub> | 197.7k <sub>126×</sub> | 701.0k <sub>36×</sub> |

### Arithmetic (from epoch ms)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Add 7 days | 11.39M <sub>33×</sub> | **375.44M** | 185.74M <sub>2.0×</sub> | 122.8k <sub>3057×</sub> | 136.0k <sub>2761×</sub> | 1.00M <sub>375×</sub> |
| Add 1 month, end-of-month clamped | 4.47M <sub>7.2×</sub> | **32.23M** | 29.17M <sub>1.1×</sub> | 123.1k <sub>262×</sub> | 136.8k <sub>236×</sub> | 375.9k <sub>86×</sub> |
| Truncate to start of UTC day | 8.98M <sub>11×</sub> | **94.54M** | 91.09M <sub>1.0×</sub> | 151.3k <sub>625×</sub> | 184.0k <sub>514×</sub> | 1.67M <sub>57×</sub> |
| Whole calendar days between two instants | 4.59M <sub>60×</sub> | **275.74M** | 172.44M <sub>1.6×</sub> | 19.5k <sub>14127×</sub> | 76.1k <sub>3622×</sub> | 664.0k <sub>415×</sub> |

### Arithmetic (native object in)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Add 7 days to an existing instance | 12.17M <sub>35×</sub> | &mdash; | **430.11M** | 296.3k <sub>1451×</sub> | 157.3k <sub>2735×</sub> | 1.24M <sub>346×</sub> |
| Add 1 month to an existing instance | 4.52M <sub>7.2×</sub> | &mdash; | **32.50M** | 306.7k <sub>106×</sub> | 152.9k <sub>213×</sub> | 422.0k <sub>77×</sub> |

### Field access

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Read all six calendar fields | 9.04M <sub>4.6×</sub> | **41.20M** | 13.62M <sub>3.0×</sub> | 209.2k <sub>197×</sub> | 48.6k <sub>848×</sub> | 5.54M <sub>7.4×</sub> |
| ISO day of week (1=Mon..7=Sun) | 19.83M <sub>11×</sub> | **210.38M** | 176.16M <sub>1.2×</sub> | 232.2k <sub>906×</sub> | 241.0k <sub>873×</sub> | 7.02M <sub>30×</sub> |
| ISO-8601 week number | 4.31M <sub>9.0×</sub> | **38.83M** | 38.37M <sub>1.0×</sub> | 197.2k <sub>197×</sub> | 204.2k <sub>190×</sub> | 162.8k <sub>238×</sub> |

### Bulk workloads

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Sort 2000 instants | 658 <sub>7.0×</sub> | 4.4k <sub>1.1×</sub> | **4.6k** | 2.0k <sub>2.3×</sub> | 52 <sub>89×</sub> | 2.8k <sub>1.7×</sub> |
| Pipeline: parse then +30 days then format | 1.39M <sub>6.9×</sub> | **9.61M** | 5.74M <sub>1.7×</sub> | 80.7k <sub>119×</sub> | 72.1k <sub>133×</sub> | 513.0k <sub>19×</sub> |
| Parse 10000 ISO strings and count per UTC day | 149 <sub>17×</sub> | **2.5k** | 1.1k <sub>2.2×</sub> | 4 <sub>688×</sub> | 9 <sub>281×</sub> | 56 <sub>45×</sub> |

### Timezone (Europe/Bratislava)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| UTC offset for an instant | 382.3k <sub>197×</sub> | **75.17M** | 49.30M <sub>1.5×</sub> | 168.6k <sub>446×</sub> | 274.8k <sub>274×</sub> | 21.2k <sub>3549×</sub> |
| Format instant as local ISO with offset | 343.5k <sub>32×</sub> | **10.91M** | 9.80M <sub>1.1×</sub> | 143.5k <sub>76×</sub> | 106.0k <sub>103×</sub> | 19.0k <sub>574×</sub> |
| Add 1 local day across DST | 120.6k <sub>188×</sub> | **22.68M** | 20.41M <sub>1.1×</sub> | 100.8k <sub>225×</sub> | 57.5k <sub>395×</sub> | **MISMATCH** |
| Local midnight for an instant | 81.1k <sub>167×</sub> | 12.20M <sub>1.1×</sub> | **13.57M** | 108.2k <sub>125×</sub> | 64.7k <sub>210×</sub> | 8.9k <sub>1529×</sub> |
| Bucket 10000 instants by LOCAL day | 19 <sub>197×</sub> | **3.7k** | 3.4k <sub>1.1×</sub> | 5 <sub>693×</sub> | 13 <sub>273×</sub> | 1 <sub>3160×</sub> |

## Node 24 with --harmony-temporal

> `temporal-polyfill` v1 re-exports native `Temporal` when it exists (`TP.Temporal === globalThis.Temporal`), so it is listed once here, as **Temporal native**.


### Parsing

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 7.42M <sub>3.6×</sub> | **26.44M** | 26.02M <sub>1.0×</sub> | 3.18M <sub>8.3×</sub> | 486.6k <sub>54×</sub> | 3.12M <sub>8.5×</sub> |
| Parse ISO-8601 with UTC offset | 6.84M <sub>2.6×</sub> | 16.86M <sub>1.0×</sub> | **17.54M** | 2.76M <sub>6.4×</sub> | 357.1k <sub>49×</sub> | 872.9k <sub>20×</sub> |

### Formatting

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Format epoch ms to ISO-8601 UTC | 1.93M <sub>8.3×</sub> | **16.03M** | 15.89M <sub>1.0×</sub> | 719.2k <sub>22×</sub> | 133.5k <sub>120×</sub> | 1.41M <sub>11×</sub> |
| Format epoch ms to YYYY-MM-DD (UTC) | 1.91M <sub>13×</sub> | **24.36M** | 22.99M <sub>1.1×</sub> | 160.2k <sub>152×</sub> | 197.5k <sub>123×</sub> | 670.2k <sub>36×</sub> |

### Arithmetic (from epoch ms)

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Add 7 days | 11.01M <sub>34×</sub> | **375.59M** | 240.43M <sub>1.6×</sub> | 136.0k <sub>2763×</sub> | 131.1k <sub>2864×</sub> | 1.04M <sub>362×</sub> |
| Add 1 month, end-of-month clamped | 4.19M <sub>7.6×</sub> | **31.89M** | 28.29M <sub>1.1×</sub> | 136.8k <sub>233×</sub> | 133.5k <sub>239×</sub> | 311.4k <sub>102×</sub> |
| Truncate to start of UTC day | 8.68M <sub>11×</sub> | **94.13M** | 90.34M <sub>1.0×</sub> | 185.3k <sub>508×</sub> | 162.0k <sub>581×</sub> | 1.59M <sub>59×</sub> |
| Whole calendar days between two instants | 4.11M <sub>44×</sub> | **180.61M** | 139.58M <sub>1.3×</sub> | 78.0k <sub>2315×</sub> | 68.9k <sub>2620×</sub> | 620.4k <sub>291×</sub> |

### Arithmetic (native object in)

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Add 7 days to an existing instance | 10.74M <sub>33×</sub> | &mdash; | **350.26M** | 394.4k <sub>888×</sub> | 123.0k <sub>2848×</sub> | 1.15M <sub>305×</sub> |
| Add 1 month to an existing instance | 4.12M <sub>6.8×</sub> | &mdash; | **28.07M** | 444.0k <sub>63×</sub> | 145.2k <sub>193×</sub> | 396.8k <sub>71×</sub> |

### Field access

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Read all six calendar fields | 8.94M <sub>4.5×</sub> | **39.83M** | 13.59M <sub>2.9×</sub> | 144.3k <sub>276×</sub> | 43.7k <sub>912×</sub> | 5.44M <sub>7.3×</sub> |
| ISO day of week (1=Mon..7=Sun) | 21.21M <sub>11×</sub> | **231.15M** | 181.38M <sub>1.3×</sub> | 207.3k <sub>1115×</sub> | 234.3k <sub>986×</sub> | 6.82M <sub>34×</sub> |
| ISO-8601 week number | 4.35M <sub>8.9×</sub> | 38.34M <sub>1.0×</sub> | **38.68M** | 191.4k <sub>202×</sub> | 198.0k <sub>195×</sub> | 136.5k <sub>283×</sub> |

### Bulk workloads

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Sort 2000 instants | 648 <sub>7.2×</sub> | 4.5k <sub>1.1×</sub> | **4.7k** | 2.4k <sub>1.9×</sub> | 47 <sub>100×</sub> | 2.6k <sub>1.8×</sub> |
| Pipeline: parse then +30 days then format | 1.37M <sub>7.3×</sub> | **10.05M** | 9.78M <sub>1.0×</sub> | 110.7k <sub>91×</sub> | 73.6k <sub>136×</sub> | 539.1k <sub>19×</sub> |
| Parse 10000 ISO strings and count per UTC day | 151 <sub>16×</sub> | **2.4k** | 2.4k <sub>1.0×</sub> | 19 <sub>126×</sub> | 14 <sub>174×</sub> | 56 <sub>44×</sub> |

### Timezone (Europe/Bratislava)

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| UTC offset for an instant | 373.8k <sub>180×</sub> | **67.31M** | 50.42M <sub>1.3×</sub> | 7.5k <sub>8963×</sub> | 249.6k <sub>270×</sub> | 20.6k <sub>3260×</sub> |
| Format instant as local ISO with offset | 327.3k <sub>33×</sub> | **10.87M** | 10.79M <sub>1.0×</sub> | 5.0k <sub>2193×</sub> | 100.4k <sub>108×</sub> | 17.7k <sub>616×</sub> |
| Add 1 local day across DST | 106.3k <sub>153×</sub> | **16.26M** | 12.15M <sub>1.3×</sub> | 4.8k <sub>3384×</sub> | 54.1k <sub>300×</sub> | **MISMATCH** |
| Local midnight for an instant | 98.7k <sub>152×</sub> | **15.04M** | 14.96M <sub>1.0×</sub> | 4.9k <sub>3085×</sub> | 59.3k <sub>254×</sub> | 8.8k <sub>1703×</sub> |
| Bucket 10000 instants by LOCAL day | 29 <sub>296×</sub> | **8.6k** | 6.4k <sub>1.3×</sub> | 0.54 <sub>15932×</sub> | 14 <sub>616×</sub> | 1 <sub>7360×</sub> |

## Bun 1.3


### Parsing

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 6.35M <sub>5.8×</sub> | **37.03M** | 36.24M <sub>1.0×</sub> | 340.1k <sub>109×</sub> | 512.3k <sub>72×</sub> | 3.68M <sub>10×</sub> |
| Parse ISO-8601 with UTC offset | 6.05M <sub>4.0×</sub> | **24.07M** | 22.89M <sub>1.1×</sub> | 278.4k <sub>86×</sub> | 349.0k <sub>69×</sub> | 1.51M <sub>16×</sub> |

### Formatting

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Format epoch ms to ISO-8601 UTC | 6.28M <sub>1.6×</sub> | **10.16M** | 9.89M <sub>1.0×</sub> | 306.2k <sub>33×</sub> | 155.6k <sub>65×</sub> | 4.03M <sub>2.5×</sub> |
| Format epoch ms to YYYY-MM-DD (UTC) | 4.48M <sub>3.8×</sub> | **17.19M** | 16.85M <sub>1.0×</sub> | 177.3k <sub>97×</sub> | 181.7k <sub>95×</sub> | 897.5k <sub>19×</sub> |

### Arithmetic (from epoch ms)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Add 7 days | 13.62M <sub>31×</sub> | **426.25M** | 367.68M <sub>1.2×</sub> | 107.2k <sub>3977×</sub> | 124.3k <sub>3430×</sub> | 1.49M <sub>286×</sub> |
| Add 1 month, end-of-month clamped | 6.23M <sub>4.9×</sub> | 29.47M <sub>1.0×</sub> | **30.39M** | 114.3k <sub>266×</sub> | 126.6k <sub>240×</sub> | 465.6k <sub>65×</sub> |
| Truncate to start of UTC day | 12.28M <sub>19×</sub> | **234.28M** | 137.83M <sub>1.7×</sub> | 131.4k <sub>1783×</sub> | 172.9k <sub>1355×</sub> | 1.97M <sub>119×</sub> |
| Whole calendar days between two instants | 6.13M <sub>78×</sub> | **475.09M** | 398.56M <sub>1.2×</sub> | 30.3k <sub>15675×</sub> | 73.2k <sub>6491×</sub> | 690.6k <sub>688×</sub> |

### Arithmetic (native object in)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Add 7 days to an existing instance | 13.88M <sub>26×</sub> | &mdash; | **366.11M** | 211.9k <sub>1728×</sub> | 134.9k <sub>2714×</sub> | 1.71M <sub>214×</sub> |
| Add 1 month to an existing instance | 6.24M <sub>4.5×</sub> | &mdash; | **27.96M** | 242.4k <sub>115×</sub> | 142.7k <sub>196×</sub> | 422.5k <sub>66×</sub> |

### Field access

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Read all six calendar fields | 13.06M <sub>3.2×</sub> | **41.86M** | 33.81M <sub>1.2×</sub> | 195.2k <sub>214×</sub> | 42.3k <sub>989×</sub> | 9.18M <sub>4.6×</sub> |
| ISO day of week (1=Mon..7=Sun) | 21.45M <sub>18×</sub> | 278.20M <sub>1.4×</sub> | **386.07M** | 200.5k <sub>1926×</sub> | 223.9k <sub>1724×</sub> | 8.78M <sub>44×</sub> |
| ISO-8601 week number | 5.23M <sub>7.5×</sub> | 37.67M <sub>1.0×</sub> | **39.42M** | 184.4k <sub>214×</sub> | 186.8k <sub>211×</sub> | 207.7k <sub>190×</sub> |

### Bulk workloads

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Sort 2000 instants | 283 <sub>16×</sub> | 4.5k <sub>1.0×</sub> | **4.5k** | 1.9k <sub>2.3×</sub> | 162 <sub>28×</sub> | 3.9k <sub>1.2×</sub> |
| Pipeline: parse then +30 days then format | 2.50M <sub>3.0×</sub> | **7.46M** | 7.41M <sub>1.0×</sub> | 71.3k <sub>105×</sub> | 60.5k <sub>123×</sub> | 803.6k <sub>9.3×</sub> |
| Parse 10000 ISO strings and count per UTC day | 243 <sub>14×</sub> | 3.0k <sub>1.1×</sub> | **3.4k** | 12 <sub>281×</sub> | 15 <sub>228×</sub> | 70 <sub>48×</sub> |

### Timezone (Europe/Bratislava)

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| UTC offset for an instant | 519.4k <sub>138×</sub> | 48.08M <sub>1.5×</sub> | **71.47M** | 147.0k <sub>486×</sub> | 262.2k <sub>273×</sub> | 27.7k <sub>2580×</sub> |
| Format instant as local ISO with offset | 474.4k <sub>15×</sub> | **7.33M** | 7.13M <sub>1.0×</sub> | 117.7k <sub>62×</sub> | 94.5k <sub>78×</sub> | 25.0k <sub>293×</sub> |
| Add 1 local day across DST | 166.8k <sub>136×</sub> | **22.75M** | 20.12M <sub>1.1×</sub> | 62.1k <sub>367×</sub> | 51.3k <sub>443×</sub> | **MISMATCH** |
| Local midnight for an instant | 151.5k <sub>109×</sub> | **16.49M** | 15.14M <sub>1.1×</sub> | 101.4k <sub>163×</sub> | 58.3k <sub>283×</sub> | 13.0k <sub>1273×</sub> |
| Bucket 10000 instants by LOCAL day | 46 <sub>113×</sub> | 5.1k <sub>1.0×</sub> | **5.2k** | 12 <sub>421×</sub> | 15 <sub>354×</sub> | 2 <sub>2892×</sub> |

## Allocation pressure (approximate bytes per operation)

Measured on Node 24.13.0 by heap delta around short forced-GC windows. Directional, not exact — enough to separate "allocates nothing" from "allocates a dozen objects".

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 17 B | 17 B | 17 B | 7248 B | 2700 B | 55 B |
| Parse ISO-8601 with UTC offset | 17 B | 17 B | 17 B | 8094 B | 3525 B | 585 B |
| Format epoch ms to ISO-8601 UTC | 153 B | 57 B | 89 B | 8904 B | 5680 B | 33 B |
| Format epoch ms to YYYY-MM-DD (UTC) | 185 B | 33 B | 81 B | 15933 B | 5147 B | 595 B |
| Add 7 days | 145 B | 16 B | 97 B | 23481 B | 8267 B | 1220 B |
| Add 1 month, end-of-month clamped | 240 B | 17 B | 96 B | 22738 B | 8212 B | 2132 B |
| Truncate to start of UTC day | 129 B | 17 B | 97 B | 21521 B | 5490 B | 66 B |
| Whole calendar days between two instants | 256 B | 0 B | 48 B | &mdash; | 15163 B | 1525 B |
| Add 7 days to an existing instance | 129 B | &mdash; | 16 B | 9894 B | 7294 B | 925 B |
| Add 1 month to an existing instance | 224 B | &mdash; | 17 B | 9732 B | 7241 B | 1699 B |
| Read all six calendar fields | 129 B | 17 B | 104 B | 14525 B | &mdash; | 81 B |
| ISO day of week (1=Mon..7=Sun) | 113 B | 1 B | 49 B | 13198 B | 3860 B | 15 B |
| ISO-8601 week number | 353 B | 1 B | 49 B | 14553 B | 6062 B | 5320 B |
| Pipeline: parse then +30 days then format | 153 B | 73 B | 148 B | 34145 B | 14780 B | 1445 B |
| UTC offset for an instant | 1005 B | 4 B | 60 B | 17005 B | 3645 B | &mdash; |
| Format instant as local ISO with offset | 1766 B | 68 B | 108 B | 21014 B | 9013 B | &mdash; |
| Add 1 local day across DST | 3328 B | 40 B | 137 B | 27201 B | 17495 B | &mdash; |
| Local midnight for an instant | 3645 B | 40 B | 144 B | 25741 B | 14607 B | &mdash; |

## Node vs Bun, same code

Ratio above 1 means Bun is faster.

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 0.83× | **1.31×** | **1.32×** | 0.92× | **1.12×** | **1.43×** |
| Parse ISO-8601 with UTC offset | 0.88× | **1.35×** | **1.30×** | 0.88× | 0.91× | **1.72×** |
| Format epoch ms to ISO-8601 UTC | **3.19×** | 0.62× | 0.61× | 0.85× | 0.84× | **2.60×** |
| Format epoch ms to YYYY-MM-DD (UTC) | **2.28×** | 0.69× | 0.70× | 0.90× | 0.92× | **1.28×** |
| Add 7 days | **1.20×** | **1.14×** | **1.98×** | 0.87× | 0.91× | **1.49×** |
| Add 1 month, end-of-month clamped | **1.40×** | 0.91× | **1.04×** | 0.93× | 0.93× | **1.24×** |
| Truncate to start of UTC day | **1.37×** | **2.48×** | **1.51×** | 0.87× | 0.94× | **1.18×** |
| Whole calendar days between two instants | **1.33×** | **1.72×** | **2.31×** | **1.55×** | 0.96× | **1.04×** |
| Add 7 days to an existing instance | **1.14×** | &mdash; | 0.85× | 0.71× | 0.86× | **1.38×** |
| Add 1 month to an existing instance | **1.38×** | &mdash; | 0.86× | 0.79× | 0.93× | **1.00×** |
| Read all six calendar fields | **1.44×** | **1.02×** | **2.48×** | 0.93× | 0.87× | **1.66×** |
| ISO day of week (1=Mon..7=Sun) | **1.08×** | **1.32×** | **2.19×** | 0.86× | 0.93× | **1.25×** |
| ISO-8601 week number | **1.21×** | 0.97× | **1.03×** | 0.94× | 0.91× | **1.28×** |
| Sort 2000 instants | 0.43× | **1.01×** | 0.97× | 0.96× | **3.12×** | **1.40×** |
| Pipeline: parse then +30 days then format | **1.79×** | 0.78× | **1.29×** | 0.88× | 0.84× | **1.57×** |
| Parse 10000 ISO strings and count per UTC day | **1.63×** | **1.19×** | **2.96×** | **3.29×** | **1.66×** | **1.25×** |
| UTC offset for an instant | **1.36×** | 0.64× | **1.45×** | 0.87× | 0.95× | **1.31×** |
| Format instant as local ISO with offset | **1.38×** | 0.67× | 0.73× | 0.82× | 0.89× | **1.32×** |
| Add 1 local day across DST | **1.38×** | **1.00×** | 0.99× | 0.62× | 0.89× | &mdash; |
| Local midnight for an instant | **1.87×** | **1.35×** | **1.12×** | 0.94× | 0.90× | **1.46×** |
| Bucket 10000 instants by LOCAL day | **2.49×** | **1.40×** | **1.55×** | **2.35×** | **1.10×** | **1.56×** |

## Per-operation median cost

<details><summary>Node 24 (default)</summary>

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 131.5 ns | 35.4 ns | 36.5 ns | 2.71 µs | 2.19 µs | 388.0 ns |
| Parse ISO-8601 with UTC offset | 145.1 ns | 56.0 ns | 56.6 ns | 3.18 µs | 2.60 µs | 1.14 µs |
| Format epoch ms to ISO-8601 UTC | 507.0 ns | 61.0 ns | 61.3 ns | 2.76 µs | 5.41 µs | 644.8 ns |
| Format epoch ms to YYYY-MM-DD (UTC) | 509.4 ns | 40.1 ns | 41.7 ns | 5.07 µs | 5.06 µs | 1.43 µs |
| Add 7 days | 87.8 ns | 2.7 ns | 5.4 ns | 8.14 µs | 7.35 µs | 997.5 ns |
| Add 1 month, end-of-month clamped | 224.0 ns | 31.0 ns | 34.3 ns | 8.12 µs | 7.31 µs | 2.66 µs |
| Truncate to start of UTC day | 111.3 ns | 10.6 ns | 11.0 ns | 6.61 µs | 5.43 µs | 599.8 ns |
| Whole calendar days between two instants | 217.7 ns | 3.6 ns | 5.8 ns | 51.23 µs | 13.14 µs | 1.51 µs |
| Add 7 days to an existing instance | 82.2 ns | &mdash; | 2.3 ns | 3.37 µs | 6.36 µs | 805.5 ns |
| Add 1 month to an existing instance | 221.4 ns | &mdash; | 30.8 ns | 3.26 µs | 6.54 µs | 2.37 µs |
| Read all six calendar fields | 110.6 ns | 24.3 ns | 73.4 ns | 4.78 µs | 20.59 µs | 180.4 ns |
| ISO day of week (1=Mon..7=Sun) | 50.4 ns | 4.8 ns | 5.7 ns | 4.31 µs | 4.15 µs | 142.4 ns |
| ISO-8601 week number | 232.2 ns | 25.8 ns | 26.1 ns | 5.07 µs | 4.90 µs | 6.14 µs |
| Sort 2000 instants | 1.52 ms | 226.80 µs | 215.63 µs | 499.33 µs | 19.27 ms | 359.55 µs |
| Pipeline: parse then +30 days then format | 718.0 ns | 104.0 ns | 174.1 ns | 12.38 µs | 13.86 µs | 1.95 µs |
| Parse 10000 ISO strings and count per UTC day | 6.70 ms | 396.93 µs | 873.77 µs | 272.99 ms | 111.72 ms | 17.88 ms |
| UTC offset for an instant | 2.62 µs | 13.3 ns | 20.3 ns | 5.93 µs | 3.64 µs | 47.21 µs |
| Format instant as local ISO with offset | 2.91 µs | 91.7 ns | 102.0 ns | 6.97 µs | 9.43 µs | 52.65 µs |
| Add 1 local day across DST | 8.29 µs | 44.1 ns | 49.0 ns | 9.92 µs | 17.40 µs | mismatch |
| Local midnight for an instant | 12.33 µs | 82.0 ns | 73.7 ns | 9.24 µs | 15.46 µs | 112.61 µs |
| Bucket 10000 instants by LOCAL day | 54.02 ms | 273.96 µs | 295.90 µs | 189.83 ms | 74.82 ms | 865.75 ms |

</details>

<details><summary>Node 24 with --harmony-temporal</summary>

| Operation | Date | chronoFast raw | chronoFast class | Temporal native | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 134.8 ns | 37.8 ns | 38.4 ns | 314.5 ns | 2.06 µs | 321.0 ns |
| Parse ISO-8601 with UTC offset | 146.3 ns | 59.3 ns | 57.0 ns | 362.9 ns | 2.80 µs | 1.15 µs |
| Format epoch ms to ISO-8601 UTC | 518.0 ns | 62.4 ns | 62.9 ns | 1.39 µs | 7.49 µs | 709.6 ns |
| Format epoch ms to YYYY-MM-DD (UTC) | 524.1 ns | 41.1 ns | 43.5 ns | 6.24 µs | 5.06 µs | 1.49 µs |
| Add 7 days | 90.8 ns | 2.7 ns | 4.2 ns | 7.36 µs | 7.63 µs | 963.0 ns |
| Add 1 month, end-of-month clamped | 238.5 ns | 31.4 ns | 35.4 ns | 7.31 µs | 7.49 µs | 3.21 µs |
| Truncate to start of UTC day | 115.2 ns | 10.6 ns | 11.1 ns | 5.40 µs | 6.17 µs | 630.7 ns |
| Whole calendar days between two instants | 243.6 ns | 5.5 ns | 7.2 ns | 12.82 µs | 14.50 µs | 1.61 µs |
| Add 7 days to an existing instance | 93.1 ns | &mdash; | 2.9 ns | 2.54 µs | 8.13 µs | 871.0 ns |
| Add 1 month to an existing instance | 242.6 ns | &mdash; | 35.6 ns | 2.25 µs | 6.89 µs | 2.52 µs |
| Read all six calendar fields | 111.8 ns | 25.1 ns | 73.6 ns | 6.93 µs | 22.90 µs | 183.8 ns |
| ISO day of week (1=Mon..7=Sun) | 47.2 ns | 4.3 ns | 5.5 ns | 4.83 µs | 4.27 µs | 146.7 ns |
| ISO-8601 week number | 229.7 ns | 26.1 ns | 25.9 ns | 5.22 µs | 5.05 µs | 7.33 µs |
| Sort 2000 instants | 1.54 ms | 224.67 µs | 213.45 µs | 411.53 µs | 21.38 ms | 383.50 µs |
| Pipeline: parse then +30 days then format | 728.9 ns | 99.5 ns | 102.2 ns | 9.03 µs | 13.58 µs | 1.85 µs |
| Parse 10000 ISO strings and count per UTC day | 6.62 ms | 411.83 µs | 421.77 µs | 51.69 ms | 71.62 ms | 18.02 ms |
| UTC offset for an instant | 2.68 µs | 14.9 ns | 19.8 ns | 133.17 µs | 4.01 µs | 48.43 µs |
| Format instant as local ISO with offset | 3.06 µs | 92.0 ns | 92.7 ns | 201.80 µs | 9.96 µs | 56.63 µs |
| Add 1 local day across DST | 9.41 µs | 61.5 ns | 82.3 ns | 208.12 µs | 18.47 µs | mismatch |
| Local midnight for an instant | 10.14 µs | 66.5 ns | 66.8 ns | 205.17 µs | 16.87 µs | 113.24 µs |
| Bucket 10000 instants by LOCAL day | 34.63 ms | 116.90 µs | 155.50 µs | 1862.48 ms | 72.06 ms | 860.41 ms |

</details>

<details><summary>Bun 1.3</summary>

| Operation | Date | chronoFast raw | chronoFast class | temporal-polyfill | @js-temporal | Day.js |
|---|--:|--:|--:|--:|--:|--:|
| Parse ISO-8601 UTC string | 157.6 ns | 27.0 ns | 27.6 ns | 2.94 µs | 1.95 µs | 271.7 ns |
| Parse ISO-8601 with UTC offset | 165.2 ns | 41.5 ns | 43.7 ns | 3.59 µs | 2.87 µs | 662.0 ns |
| Format epoch ms to ISO-8601 UTC | 159.1 ns | 98.4 ns | 101.1 ns | 3.27 µs | 6.43 µs | 248.4 ns |
| Format epoch ms to YYYY-MM-DD (UTC) | 223.3 ns | 58.2 ns | 59.4 ns | 5.64 µs | 5.50 µs | 1.11 µs |
| Add 7 days | 73.4 ns | 2.3 ns | 2.7 ns | 9.33 µs | 8.05 µs | 670.5 ns |
| Add 1 month, end-of-month clamped | 160.4 ns | 33.9 ns | 32.9 ns | 8.75 µs | 7.90 µs | 2.15 µs |
| Truncate to start of UTC day | 81.4 ns | 4.3 ns | 7.3 ns | 7.61 µs | 5.79 µs | 507.3 ns |
| Whole calendar days between two instants | 163.2 ns | 2.1 ns | 2.5 ns | 32.99 µs | 13.66 µs | 1.45 µs |
| Add 7 days to an existing instance | 72.0 ns | &mdash; | 2.7 ns | 4.72 µs | 7.41 µs | 584.7 ns |
| Add 1 month to an existing instance | 160.2 ns | &mdash; | 35.8 ns | 4.13 µs | 7.01 µs | 2.37 µs |
| Read all six calendar fields | 76.6 ns | 23.9 ns | 29.6 ns | 5.12 µs | 23.64 µs | 108.9 ns |
| ISO day of week (1=Mon..7=Sun) | 46.6 ns | 3.6 ns | 2.6 ns | 4.99 µs | 4.47 µs | 113.9 ns |
| ISO-8601 week number | 191.3 ns | 26.5 ns | 25.4 ns | 5.42 µs | 5.35 µs | 4.82 µs |
| Sort 2000 instants | 3.54 ms | 224.15 µs | 221.80 µs | 520.30 µs | 6.17 ms | 257.20 µs |
| Pipeline: parse then +30 days then format | 400.5 ns | 134.1 ns | 135.0 ns | 14.03 µs | 16.53 µs | 1.24 µs |
| Parse 10000 ISO strings and count per UTC day | 4.12 ms | 332.95 µs | 295.50 µs | 83.02 ms | 67.31 ms | 14.26 ms |
| UTC offset for an instant | 1.93 µs | 20.8 ns | 14.0 ns | 6.80 µs | 3.81 µs | 36.10 µs |
| Format instant as local ISO with offset | 2.11 µs | 136.5 ns | 140.3 ns | 8.49 µs | 10.58 µs | 39.99 µs |
| Add 1 local day across DST | 5.99 µs | 44.0 ns | 49.7 ns | 16.11 µs | 19.49 µs | mismatch |
| Local midnight for an instant | 6.60 µs | 60.6 ns | 66.1 ns | 9.86 µs | 17.14 µs | 77.18 µs |
| Bucket 10000 instants by LOCAL day | 21.72 ms | 196.04 µs | 191.39 µs | 80.63 ms | 67.72 ms | 553.41 ms |

</details>
