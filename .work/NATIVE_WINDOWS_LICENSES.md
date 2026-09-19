# Windows 의존성 라이선스 선언

`cargo metadata --locked --filter-platform x86_64-pc-windows-msvc` resolve graph 기준. 자체 패키지 포함 508개. macOS 및 다른 타깃, 최종 배포 고지 의무의 법률 검토는 포함하지 않는다.

| 선언 | 패키지 수 |
| --- | ---: |
| (Apache-2.0 OR MIT) AND BSD-3-Clause | 1 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 |
| 0BSD OR MIT OR Apache-2.0 | 1 |
| Apache-2.0 | 16 |
| Apache-2.0 / MIT | 1 |
| Apache-2.0 AND ISC | 1 |
| Apache-2.0 AND MIT | 1 |
| Apache-2.0 OR BSL-1.0 | 1 |
| Apache-2.0 OR ISC OR MIT | 4 |
| Apache-2.0 OR MIT | 67 |
| Apache-2.0 WITH LLVM-exception | 1 |
| Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | 1 |
| Apache-2.0/MIT | 7 |
| BSD-2-Clause | 4 |
| BSD-2-Clause OR Apache-2.0 OR MIT | 2 |
| BSD-3-Clause | 8 |
| BSD-3-Clause OR Apache-2.0 | 2 |
| CC0-1.0 | 2 |
| CC0-1.0 OR Apache-2.0 | 1 |
| CC0-1.0 OR MIT-0 OR Apache-2.0 | 1 |
| CDLA-Permissive-2.0 | 1 |
| ISC | 3 |
| MIT | 102 |
| MIT / Apache-2.0 | 1 |
| MIT OR Apache-2.0 | 216 |
| MIT OR Apache-2.0 OR Zlib | 5 |
| MIT OR Zlib OR Apache-2.0 | 2 |
| MIT/Apache-2.0 | 22 |
| Unicode-3.0 | 18 |
| Unlicense OR MIT | 6 |
| Unlicense/MIT | 2 |
| Zlib | 4 |
| Zlib OR Apache-2.0 OR MIT | 3 |

MPL 경로가 있던 직접 의존성 dirs 5를 GPUI가 사용하는 dirs 4로 통일했다. Windows graph에서 GPL/LGPL/MPL 또는 license 미지정 패키지는 발견되지 않았다. 전체 Cargo.lock에는 타깃별 간접 의존성이 남으므로 모든 타깃에 같은 결론을 적용할 수 없다.
