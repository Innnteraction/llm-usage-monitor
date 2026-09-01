# LLM Usage Monitor

## 요약

LLM Usage Monitor는 Codex와 Claude Code 구독 계정의 5시간·주간 quota를 직관적으로 보여 주기 위한 Windows 트레이 앱이다. quota는 계정 전체의 벤더 서버 값을 주 정보로 다루고, 실제 토큰 사용량은 이 PC의 로컬 로그에서 집계한 보조 정보로 구분한다. v1은 Codex와 Claude Code를 필수 대상으로 하며 Gemini는 후속 확장 대상이다.

## 제품 방향

- 트레이 아이콘을 누르면 보이는 작은 대시보드에 벤더별 `5h`와 `Weekly` 사용률을 가장 크게 배치한다.
- 사용률과 남은 비율, reset 카운트다운, 데이터 출처와 신선도를 함께 보여 준다.
- 벤더가 제공하지 않은 quota를 0%로 추정하지 않는다.
- 벤더 CLI가 인증을 소유한다. 이 앱은 기존 인증 파일을 수정·갱신·삭제하지 않는다.
- 후속 구현 기반은 Electron + TypeScript로 정한다.

## 문서

- [제품 컨셉과 데이터 계약](docs/product-concept.md)
- [벤치마크 조사](docs/benchmarks.md)
- [Agent 참조 인덱스](docs/agent/INDEX.md)

## 현재 범위

이 저장소는 현재 제품·보안·Agent 기준선만 포함한다. 앱 코드, Electron 스캐폴딩, 패키지 설정과 배포 자동화는 후속 작업에서 추가한다.
