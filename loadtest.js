// 200명 동시접속 부하 테스트
const { io } = require('socket.io-client');

const SERVER_URL = process.argv[2] || 'http://localhost:3000';
const NUM_USERS = parseInt(process.argv[3]) || 200;

console.log(`\n🚀 부하 테스트 시작`);
console.log(`   서버: ${SERVER_URL}`);
console.log(`   동시 접속자: ${NUM_USERS}명\n`);

let connected = 0;
let answered = 0;
let errors = 0;
const sockets = [];

for (let i = 0; i < NUM_USERS; i++) {
  setTimeout(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 10000
    });

    sockets.push(socket);

    socket.on('connect', () => {
      connected++;
      socket.emit('join', { name: `테스트유저${i+1}` });
      if (connected % 50 === 0 || connected === NUM_USERS) {
        console.log(`✅ ${connected}명 접속 완료`);
      }
    });

    socket.on('joined', () => {});

    socket.on('question_start', () => {
      // 1~3초 사이 랜덤 딜레이로 답변
      setTimeout(() => {
        const ans = Math.random() > 0.5 ? 'O' : 'X';
        socket.emit('submit_answer', { answer: ans });
        answered++;
      }, Math.random() * 3000 + 500);
    });

    socket.on('connect_error', (err) => {
      errors++;
      if (errors <= 5) console.log(`❌ 접속 오류: ${err.message}`);
    });

  }, i * 20); // 20ms 간격으로 순차 접속
}

// 10초 후 상태 보고
setTimeout(() => {
  console.log(`\n📊 테스트 결과 (10초 후)`);
  console.log(`   접속 성공: ${connected}/${NUM_USERS}명`);
  console.log(`   답변 제출: ${answered}명`);
  console.log(`   오류: ${errors}건`);
  console.log(`   메모리: ${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`);

  // 연결 종료
  sockets.forEach(s => s.disconnect());
  console.log(`\n✅ 테스트 완료! 모든 연결 종료\n`);
  process.exit(0);
}, 10000);
