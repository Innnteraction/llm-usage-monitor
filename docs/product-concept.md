# LLM Usage Monitor 제품 컨셉

## 요약

이 문서는 초기 구현자가 Windows 트레이 앱의 정보 우선순위, provider 경계와 실패 표현을 같은 방식으로 이해하도록 돕는 설명 문서다. v1의 핵심은 Codex와 Claude Code의 5시간·주간 quota며, 로컬 토큰은 서로 다른 범위를 갖는 보조 지표다. 인증은 벤더 CLI가 소유하고 앱은 이를 변조하지 않는다. 구현 전에 이 문서의 UI 상태, 데이터 계약, 수집 경계와 수용 기준을 먼저 확인한다.

## 사용자가 얻는 결과

개발자는 작업 흐름을 끈지 않고 트레이에서 다음을 판단할 수 있어야 한다.

- 현재 5시간 창과 주간 창의 사용률이 얼마인가?
- 각 창은 언제 reset되며 남은 시간은 얼마인가?
- 표시된 값은 어느 소스에서 언제 가져왔고 아직 신뢰할 수 있는가?
- 이 PC에서 실제로 소비한 토큰은 얼마이며 quota와 왜 일치하지 않을 수 있는가?

## v1 범위와 기술 기반

- 운영체제: Windows 우선. provider 계층은 추후 macOS·Linux로 확장할 수 있게 OS 연동과 분리한다.
- 앱 형태: 시스템 트레이에 상주하고 아이콘을 누르면 작은 대시보드를 연다.
- 시각 방향: CSWAP처럼 핵심 수치를 빠르게 훑는 TUI형 정보 밀도를 사용한다. 실제 터미널 UI가 아니라 Electron renderer에서 고정폭 글꼴, 단순 테두리와 텍스트 진행 막대로 표현한다.
- 기술 기반: Electron + TypeScript. main process가 CLI·파일 수집을 담당하고 renderer는 정규화된 snapshot만 받는다.
- 필수 provider: Codex, Claude Code.
- 선택 provider: Gemini. v1에서는 확장점만 유지하고 quota 수집을 구현하지 않는다.

## 정보 구조와 표시 규칙

provider 블록의 첫 행에 `5h`와 `Weekly` 두 quota 창을 가장 크게 배치한다. 각 창은 사용률, 남은 비율, reset 절대 시각과 카운트다운, 수집 소스, 마지막 성공 시각을 함께 보여 준다. 진행 막대는 “사용한 비율”을 기준으로 통일하고 텍스트에서 남은 비율을 병기한다.

v1은 화려한 대시보드보다 읽는 속도를 우선한다. 고정폭 글꼴, 단순한 선과 여백, 텍스트 진행 막대, fresh·stale·error를 구별하는 제한된 상태색을 사용한다. 장식용 차트, 그라데이션과 불필요한 애니메이션은 넣지 않는다. 420×600 팝오버의 첫 화면에서 Codex·Claude의 핵심 quota와 reset을 식별할 수 있어야 한다.

토큰 정보는 quota 아래의 보조 영역에 배치한다. 토큰 합계에는 항상 “이 PC의 로컬 로그”라는 범위를 표시한다. 다른 장치·웹·IDE의 사용량이 계정 quota에 포함될 수 있으므로 quota 사용률과 로컬 토큰 합계를 서로 변환하거나 일치한다고 표현하지 않는다.

### 상태 표현

| 상태 | 표시 규칙 |
| --- | --- |
| 정상 | 사용률과 reset을 표시하고 마지막 갱신 시각을 노출한다. |
| stale | 마지막 정상값을 유지하되 낡은 색과 경고 배지로 지연 시간을 표시한다. |
| quota 미제공 | 0%나 무제한으로 바꾸지 않고 “벤더에서 제공하지 않음”으로 표시한다. |
| CLI 미설치 | 해당 provider를 비활성화하고 필요한 CLI 이름만 안내한다. |
| 인증 만료·미인증 | 앱이 복구를 시도하지 않고 해당 벤더 CLI에서 다시 로그인하도록 안내한다. |
| 429 | 마지막 정상값을 stale로 유지하고 재시도 시간을 표시한다. |
| 네트워크·서비스 장애 | 다른 provider와 로컬 토큰 집계를 계속하고 실패한 provider만 stale로 표시한다. |
| 파서 불일치 | 이전 값을 stale로 유지하고 `unsupported_output`을 기록하되 원문과 자격증은 로그하지 않는다. |

## 갱신과 실패 처리

quota는 기본 60초 간격으로 갱신한다. 명시적인 `Retry-After`가 있으면 이를 우선하고, 429와 일시 장애에는 60초, 120초, 240초, 480초, 900초로 늘어나는 재시도 간격을 적용한다. 한 번 성공하면 60초로 돌아간다. 수동 새로 고침은 진행 중인 요청을 중복 실행하지 않고 한 번의 후속 갱신으로 병합한다.

실패는 provider 단위로 격리한다. 한 provider의 인증·파서·네트워크 실패가 다른 provider의 갱신과 로컬 토큰 집계를 막지 않는다.

## 공통 데이터 계약

아래 타입은 구현 방향을 고정하는 개념 계약이다. 앱 스캐폴딩 단계에서 실제 TypeScript 타입으로 옮긴다.

```ts
type ProviderId = "codex" | "claude" | "gemini";
type QuotaKind = "five_hour" | "weekly" | "model_weekly" | "other";
type SnapshotStatus = "fresh" | "stale" | "unavailable";

interface ProviderSnapshot {
  providerId: ProviderId;
  accountLabel?: string;
  status: SnapshotStatus;
  fetchedAt: string;
  lastSuccessfulAt?: string;
  quotaWindows: QuotaWindow[];
  localUsage?: LocalTokenUsage;
  error?: ProviderError;
}

interface QuotaWindow {
  id: string;
  kind: QuotaKind;
  label: string;
  usedPercent?: number;
  resetsAt?: string;
  source: string;
  status: SnapshotStatus;
}

interface LocalTokenUsage {
  scope: "local_device";
  scannedFileCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  partial: boolean;
  calculatedAt: string;
}

interface ProviderError {
  code:
    | "not_installed"
    | "not_authenticated"
    | "unsupported_output"
    | "rate_limited"
    | "network"
    | "unavailable"
    | "unexpected";
  message: string;
  retryAt?: string;
}
```

`usedPercent`는 0부터 100 사이의 사용률이다. 벤더가 수치를 주지 않으면 필드를 비우고 추정하지 않는다. 남은 비율은 표시 계층에서 `100 - usedPercent`로 계산하되 입력값을 0부터 100 사이로 검증한 뒤에만 표시한다.

실제 스캔 경로는 main process 내부에만 유지한다. renderer로 전달하는 공개 계약에는 경로 대신 파일 개수만 포함한다.

## Provider 수집 경계

### Codex

- quota 기본 경로는 설치된 `codex app-server` RPC의 `account/read`와 `account/rateLimits/read`다.
- 앱은 `auth.json`을 직접 읽거나 쓰지 않는다. 인증 복구와 token refresh는 Codex CLI에만 맡긴다.
- 로컬 토큰은 `~/.codex/sessions/**/*.jsonl`을 청크 스트리밍과 증분 파싱으로 집계한다.

### Claude Code

- quota 기본 경로는 격리된 PTY에서 Claude CLI의 `/usage` 출력을 읽는 방식이다.
- 출력 형식이 알려진 계약과 다르면 추정을 계속하지 않고 `unsupported_output`을 반환한다.
- OAuth usage API 직접 호출은 사용자가 명시적으로 켜는 읽기 전용 fallback으로만 허용한다. 자격증 갱신·저장·삭제를 금지하고 만료 시 Claude CLI 재로그인을 안내한다. 이 경로는 비공개 API이므로 보장된 호환 계약으로 간주하지 않는다.
- 로컬 토큰은 `~/.claude/projects/**/*.jsonl`을 청크 스트리밍과 증분 파싱으로 집계한다.

### Gemini

provider 인터페이스의 확장 가능성만 유지한다. Gemini CLI OAuth 자격증을 읽기 전용으로 재사용하는 경로의 지원 범위와 소비자 계정 제한이 확정되기 전에는 구현하지 않는다.

## 보안 불변 조건

- 외부 자격증 파일, OS 키체인과 벤더 CLI의 인증 상태를 수정·교체·삭제하지 않는다.
- access token, refresh token, cookie, `Authorization` 헤더, credential 본문을 로그·오류·통계·fixture·문서에 남기지 않는다.
- renderer에 자격증이나 원본 CLI 출력을 보내지 않는다.
- 로그는 provider, source, 상태 코드, 갱신 시각, 재시도 시각과 익명화된 파서 버전만 기록한다.

## 초기 수용 기준

- 두 필수 provider 카드에서 5시간·주간 quota가 가장 먼저 눈에 들어온다.
- quota와 로컬 토큰의 범위가 텍스트와 구조 모두에서 구분된다.
- quota 미제공, CLI 미설치, 인증 만료, 429, 네트워크 실패와 파서 불일치가 정상값으로 오인되지 않는다.
- provider 하나의 실패가 다른 provider와 로컬 집계를 중단시키지 않는다.
- 인증 파일의 변경 시간과 내용이 앱 사용 전후로 변하지 않는다.
