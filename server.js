const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── 상태 관리 ───────────────────────────────────────────────
let state = {
  questions: [],          // 사전 등록 문제 목록
  currentQuestion: null,  // 현재 진행 중인 문제
  currentIndex: -1,
  phase: 'waiting',       // waiting | active | reveal
  answers: {},            // socketId → 'O' | 'X'
  participants: {},       // socketId → { name, score, answered }
  answerRevealed: false,
  correctAnswer: null,
  roundHistory: []        // 회차별 결과
};

// ─── 헬퍼 ────────────────────────────────────────────────────
function getStats() {
  const total = Object.keys(state.participants).length;
  const answered = Object.values(state.answers).length;
  const oCount = Object.values(state.answers).filter(a => a === 'O').length;
  const xCount = Object.values(state.answers).filter(a => a === 'X').length;
  return { total, answered, oCount, xCount };
}

function getLeaderboard() {
  return Object.entries(state.participants)
    .map(([id, p]) => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function adminState() {
  return {
    questions: state.questions,
    currentQuestion: state.currentQuestion,
    currentIndex: state.currentIndex,
    phase: state.phase,
    stats: getStats(),
    answers: state.answers,
    answerRevealed: state.answerRevealed,
    correctAnswer: state.correctAnswer,
    leaderboard: getLeaderboard(),
    roundHistory: state.roundHistory,
    participantCount: Object.keys(state.participants).length
  };
}

// ─── 라우트 ──────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ─── 소켓 ────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // 참여자 입장
  socket.on('join', ({ name }) => {
    if (!name || name.trim().length === 0) return;
    state.participants[socket.id] = { name: name.trim(), score: 0, answered: false };
    socket.join('participants');

    socket.emit('joined', {
      phase: state.phase,
      currentQuestion: state.phase === 'active' || state.phase === 'reveal'
        ? { text: state.currentQuestion?.text, index: state.currentIndex, total: state.questions.length }
        : null,
      myAnswer: state.answers[socket.id] || null,
      answerRevealed: state.answerRevealed,
      correctAnswer: state.answerRevealed ? state.correctAnswer : null
    });

    io.to('admin').emit('admin_update', adminState());
  });

  // 관리자 입장
  socket.on('admin_join', () => {
    socket.join('admin');
    socket.emit('admin_update', adminState());
  });

  // 관리자: 문제 목록 저장
  socket.on('set_questions', ({ questions }) => {
    state.questions = questions.filter(q => q.text?.trim());
    socket.emit('admin_update', adminState());
  });

  // 관리자: 문제 시작 (인덱스 또는 커스텀)
  socket.on('start_question', ({ index, customText, customAnswer }) => {
    let question;
    if (customText) {
      question = { text: customText.trim(), answer: customAnswer || 'O' };
      state.currentIndex = -1;
    } else {
      if (index < 0 || index >= state.questions.length) return;
      question = state.questions[index];
      state.currentIndex = index;
    }

    state.currentQuestion = question;
    state.phase = 'active';
    state.answers = {};
    state.answerRevealed = false;
    state.correctAnswer = null;

    // 참여자 answered 초기화
    Object.values(state.participants).forEach(p => p.answered = false);

    io.to('participants').emit('question_start', {
      text: question.text,
      index: state.currentIndex,
      total: state.questions.length
    });
    io.to('admin').emit('admin_update', adminState());
  });

  // 참여자: 답변 제출
  socket.on('submit_answer', ({ answer }) => {
    if (state.phase !== 'active') return;
    if (!['O', 'X'].includes(answer)) return;
    if (!state.participants[socket.id]) return;

    state.answers[socket.id] = answer;
    state.participants[socket.id].answered = true;

    socket.emit('answer_received', { answer });
    io.to('admin').emit('admin_update', adminState());
  });

  // 관리자: 정답 공개
  socket.on('reveal_answer', ({ answer }) => {
    if (!['O', 'X'].includes(answer)) return;
    state.correctAnswer = answer;
    state.answerRevealed = true;
    state.phase = 'reveal';

    // 점수 집계
    let correctCount = 0;
    Object.entries(state.answers).forEach(([sid, a]) => {
      if (a === answer && state.participants[sid]) {
        state.participants[sid].score += 1;
        correctCount++;
      }
    });

    const stats = getStats();
    state.roundHistory.push({
      question: state.currentQuestion.text,
      answer,
      oCount: stats.oCount,
      xCount: stats.xCount,
      correctCount
    });

    io.to('participants').emit('answer_reveal', {
      correctAnswer: answer,
      oCount: stats.oCount,
      xCount: stats.xCount,
      total: stats.answered
    });
    io.to('admin').emit('admin_update', adminState());
  });

  // 관리자: 대기 화면으로
  socket.on('reset_round', () => {
    state.phase = 'waiting';
    state.currentQuestion = null;
    state.answers = {};
    state.answerRevealed = false;
    state.correctAnswer = null;
    io.to('participants').emit('round_reset');
    io.to('admin').emit('admin_update', adminState());
  });

  // 관리자: 전체 초기화
  socket.on('full_reset', () => {
    state = {
      questions: state.questions,
      currentQuestion: null,
      currentIndex: -1,
      phase: 'waiting',
      answers: {},
      participants: {},
      answerRevealed: false,
      correctAnswer: null,
      roundHistory: []
    };
    io.emit('full_reset');
    io.to('admin').emit('admin_update', adminState());
  });

  // 연결 해제
  socket.on('disconnect', () => {
    delete state.participants[socket.id];
    delete state.answers[socket.id];
    io.to('admin').emit('admin_update', adminState());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ OX 퀴즈 서버 실행 중: http://localhost:${PORT}`);
  console.log(`📋 관리자 페이지: http://localhost:${PORT}/admin`);
});
