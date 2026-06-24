# 🔵🔴 실시간 OX 퀴즈 시스템

배터리 잡콘서트 등 행사용 실시간 OX 퀴즈 플랫폼.  
Socket.io 기반으로 **200명 동시접속** 가능.

## 페이지 구성

| URL | 대상 |
|-----|------|
| `/` | 참여자 화면 (스마트폰으로 접속) |
| `/admin` | 관리자/진행자 화면 |

## 기능

**관리자 화면**
- 사전 문제 목록 등록 및 저장
- 즉석 문제 바로 출제
- 실시간 O/X 응답 수 & 비율 그래프
- 정답 공개 버튼 (O / X)
- 참여자 점수 실시간 순위표
- 회차별 결과 기록

**참여자 화면**
- 이름 입력 후 즉시 참여
- O / X 버튼 탭으로 답변
- 정답 공개 시 맞았는지/틀렸는지 + 전체 결과 바 표시

## 로컬 실행

```bash
npm install
npm start
# → http://localhost:3000 (참여자)
# → http://localhost:3000/admin (관리자)
```

## 배포 (Render / Railway)

### Render (무료)
1. GitHub에 이 저장소 push
2. [render.com](https://render.com) → New Web Service
3. 저장소 연결
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Deploy → URL 공유

### Railway
1. [railway.app](https://railway.app) → New Project → GitHub
2. 자동 감지 배포
3. Settings → Domain 생성

## 행사 당일 운영 가이드

1. 관리자는 `/admin` 접속 (노트북/태블릿)
2. 참여자에게 URL + QR코드 공유 (스마트폰으로 접속)
3. 사전에 문제 목록 등록 → "서버에 저장"
4. 문제 클릭 → 실시간 응답 확인 → 정답 공개 → 다음 문제
5. 최종 순위는 관리자 화면 우측에서 실시간 확인

## 기술 스택

- Node.js + Express
- Socket.io (WebSocket)
- 순수 HTML/CSS/JS (프레임워크 없음)
