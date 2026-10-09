# ParaBank k6 부하 테스트

[ParaBank](https://parabank.parasoft.com) REST API(`/parabank/services/bank`)에 대한 k6 부하 테스트 스크립트입니다.

## 시나리오 (`parabank-load-test.js`)

1. 로그인: `GET /login/{username}/{password}`
2. 계좌 목록: `GET /customers/{customerId}/accounts` (이 중 계좌 하나를 무작위로 고름)
3. 계좌 상세: `GET /accounts/{accountId}`
4. 거래 내역: `GET /accounts/{accountId}/transactions`
5. (선택) 이체: `POST /transfer?fromAccountId=&toAccountId=&amount=1` (`WRITE_OPS=true`일 때만 실행)

`setup()`에서 로그인이 되는지 먼저 확인하고, 잘못된 비밀번호를 넣으면 400이 오는지 한 번 검사합니다.

## 실행

```bash
k6 run parabank-load-test.js                    # smoke: 1 VU, 30초 (기본)
k6 run -e PROFILE=load   parabank-load-test.js  # load: 10 VU, 약 5분
k6 run -e PROFILE=stress parabank-load-test.js  # stress: 최대 50 VU, 약 7분
```

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `BASE_URL` | `https://parabank.parasoft.com/parabank/services/bank` | 대상 API 주소 |
| `PB_USERNAME` / `PB_PASSWORD` | `john` / `demo` | 로그인 계정 |
| `PROFILE` | `smoke` | `smoke` \| `load` \| `stress` |
| `WRITE_OPS` | `false` | `true`이면 이체 단계까지 실행 |

> Windows에는 `USERNAME` 시스템 환경 변수가 있어서 k6의 `__ENV`와 충돌합니다. 그래서 계정 변수에는 `PB_` 접두사를 붙였습니다.

합격 기준: 오류율 1% 미만, p95 응답시간 2초 미만(거래 내역은 3초 미만), check 성공률 99% 초과.

## ⚠️ 공개 데모 서버 주의

`parabank.parasoft.com`은 여러 사람이 함께 쓰는 공개 데모 서버입니다. 이 서버에는 smoke만 실행하세요. `load`, `stress`, `WRITE_OPS=true`는 로컬 컨테이너를 띄워서 실행합니다.

```bash
docker run -d -p 8080:8080 parasoft/parabank
# 새 컨테이너에는 데모 계정(john/demo)이 없으므로 기동 후 DB를 한 번 초기화한다
curl -X POST http://localhost:8080/parabank/services/bank/initializeDB
k6 run -e BASE_URL=http://localhost:8080/parabank/services/bank -e PROFILE=load parabank-load-test.js
```
