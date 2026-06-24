const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, transports: ['websocket', 'polling'] });
app.use(express.static(path.join(__dirname, 'public')));

let state = {
  questions: [],
  currentIndex: -1,
  phase: 'waiting',
  answers: {},
  participants: {},
  nameToScore: {},
  roundHistory: [],
  timerDuration: 30,
  timerRemaining: 0,
  timerInterval: null,
  quizRunning: false,
  revealedAnswers: {}  // index → true (공개된 문제)
};

function getStats() {
  const oCount = Object.values(state.answers).filter(a => a === 'O').length;
  const xCount = Object.values(state.answers).filter(a => a === 'X').length;
  return { answered: oCount + xCount, oCount, xCount, total: Object.keys(state.participants).length };
}

function getLeaderboard() {
  const all = {};
  Object.entries(state.nameToScore).forEach(([name, score]) => { all[name] = score; });
  Object.values(state.participants).forEach(p => { all[p.name] = p.score; });
  return Object.entries(all)
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score);
}

function adminState() {
  return {
    questions: state.questions,
    currentIndex: state.currentIndex,
    currentQuestion: state.currentIndex >= 0 ? state.questions[state.currentIndex] : null,
    phase: state.phase,
    stats: getStats(),
    leaderboard: getLeaderboard(),
    roundHistory: state.roundHistory,
    participantCount: Object.keys(state.participants).length,
    timerDuration: state.timerDuration,
    timerRemaining: state.timerRemaining,
    quizRunning: state.quizRunning,
    totalQuestions: state.questions.length,
    revealedAnswers: state.revealedAnswers
  };
}

function screenState() {
  const currentQ = state.currentIndex >= 0 ? state.questions[state.currentIndex] : null;
  const stats = getStats();
  return {
    phase: state.phase,
    currentQuestion: currentQ ? { text: currentQ.text, index: state.currentIndex, total: state.questions.length } : null,
    stats,
    leaderboard: getLeaderboard(),
    timerRemaining: state.timerRemaining,
    timerDuration: state.timerDuration,
    roundHistory: state.roundHistory,
    revealedAnswers: state.revealedAnswers
  };
}

function clearTimer() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}

function startQuestion(index) {
  if (index >= state.questions.length) { finishQuiz(); return; }
  state.currentIndex = index;
  state.phase = 'active';
  state.answers = {};
  Object.values(state.participants).forEach(p => p.answered = false);
  const q = state.questions[index];
  const payload = { text: q.text, index, total: state.questions.length, timerDuration: state.timerDuration };
  io.to('participants').emit('question_start', payload);
  io.to('screen').emit('screen_update', screenState());
  io.to('admin').emit('admin_update', adminState());
  state.timerRemaining = state.timerDuration;
  io.emit('timer_tick', { remaining: state.timerRemaining, total: state.timerDuration });
  state.timerInterval = setInterval(() => {
    state.timerRemaining--;
    io.emit('timer_tick', { remaining: state.timerRemaining, total: state.timerDuration });
    if (state.timerRemaining <= 0) { clearTimer(); timeUp(); }
  }, 1000);
}

function timeUp() {
  const q = state.questions[state.currentIndex];
  const correctAnswer = q.answer;
  let correctCount = 0;
  Object.entries(state.answers).forEach(([sid, a]) => {
    if (a === correctAnswer && state.participants[sid]) {
      state.participants[sid].score += 1;
      correctCount++;
    }
  });
  Object.values(state.participants).forEach(p => { state.nameToScore[p.name] = p.score; });
  const stats = getStats();
  state.roundHistory.push({
    index: state.currentIndex,
    question: q.text,
    answer: correctAnswer,
    oCount: stats.oCount,
    xCount: stats.xCount,
    correctCount
  });
  const isLast = state.currentIndex >= state.questions.length - 1;
  state.phase = 'intermission';
  io.to('participants').emit('timer_end');
  io.to('screen').emit('screen_update', screenState());
  io.to('admin').emit('admin_update', adminState());
  let countdown = 3;
  io.emit('intermission', { countdown, isLast });
  const intv = setInterval(() => {
    countdown--;
    if (countdown > 0) { io.emit('intermission', { countdown, isLast }); }
    else { clearInterval(intv); if (state.quizRunning) startQuestion(state.currentIndex + 1); }
  }, 1000);
}

function finishQuiz() {
  state.phase = 'finished';
  state.quizRunning = false;
  Object.values(state.participants).forEach(p => { state.nameToScore[p.name] = p.score; });
  const lb = getLeaderboard();
  io.to('participants').emit('quiz_finished', { leaderboard: lb });
  io.to('screen').emit('screen_update', screenState());
  io.to('admin').emit('admin_update', adminState());
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/screen', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));

io.on('connection', (socket) => {

  socket.on('join', ({ name }) => {
    if (!name?.trim()) return;
    const savedScore = state.nameToScore[name.trim()] || 0;
    state.participants[socket.id] = { name: name.trim(), score: savedScore, answered: false };
    socket.join('participants');
    socket.emit('joined', {
      phase: state.phase,
      currentQuestion: state.phase === 'active' ? {
        text: state.questions[state.currentIndex]?.text,
        index: state.currentIndex,
        total: state.questions.length,
        timerDuration: state.timerDuration
      } : null,
      timerRemaining: state.timerRemaining,
      timerDuration: state.timerDuration,
      leaderboard: state.phase === 'finished' ? getLeaderboard() : null,
      myAnswer: state.answers[socket.id] || null
    });
    io.to('admin').emit('admin_update', adminState());
  });

  socket.on('admin_join', () => {
    socket.join('admin');
    socket.emit('admin_update', adminState());
  });

  socket.on('screen_join', () => {
    socket.join('screen');
    socket.emit('screen_update', screenState());
  });

  socket.on('set_questions', ({ questions }) => {
    state.questions = questions.filter(q => q.text?.trim());
    io.to('admin').emit('admin_update', adminState());
  });

  socket.on('set_timer', ({ duration }) => {
    const d = parseInt(duration);
    if (d >= 5 && d <= 120) state.timerDuration = d;
    io.to('admin').emit('admin_update', adminState());
  });

  socket.on('start_quiz', () => {
    if (!state.questions.length) return;
    clearTimer();
    state.quizRunning = true;
    state.roundHistory = [];
    state.nameToScore = {};
    state.revealedAnswers = {};
    Object.values(state.participants).forEach(p => { p.score = 0; });
    startQuestion(0);
  });

  socket.on('submit_answer', ({ answer }) => {
    if (state.phase !== 'active') return;
    if (!['O', 'X'].includes(answer)) return;
    if (!state.participants[socket.id]) return;
    state.answers[socket.id] = answer;
    state.participants[socket.id].answered = true;
    socket.emit('answer_received', { answer });
    io.to('admin').emit('admin_update', adminState());
    io.to('screen').emit('screen_update', screenState());
  });

  // 정답 공개 — 참여자 + 스크린 동시에
  socket.on('reveal_answer', ({ index }) => {
    const h = state.roundHistory.find(r => r.index === index);
    const q = state.questions[index];
    if (!h || !q) return;
    state.revealedAnswers[index] = true;
    const payload = {
      questionIndex: index,
      questionText: q.text,
      correctAnswer: h.answer,
      oCount: h.oCount,
      xCount: h.xCount,
      correctCount: h.correctCount
    };
    io.to('participants').emit('answer_reveal', payload);
    io.to('screen').emit('answer_reveal', payload);
    io.to('admin').emit('admin_update', adminState());
  });

  socket.on('full_reset', () => {
    clearTimer();
    state = {
      questions: state.questions,
      currentIndex: -1,
      phase: 'waiting',
      answers: {},
      participants: {},
      nameToScore: {},
      roundHistory: [],
      timerDuration: state.timerDuration,
      timerRemaining: 0,
      timerInterval: null,
      quizRunning: false,
      revealedAnswers: {}
    };
    io.emit('full_reset');
    io.to('admin').emit('admin_update', adminState());
    io.to('screen').emit('screen_update', screenState());
  });

  socket.on('disconnect', () => {
    const p = state.participants[socket.id];
    if (p) state.nameToScore[p.name] = p.score;
    delete state.participants[socket.id];
    delete state.answers[socket.id];
    io.to('admin').emit('admin_update', adminState());
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ OX 퀴즈 서버: http://localhost:${PORT}`);
  console.log(`📋 관리자: http://localhost:${PORT}/admin`);
  console.log(`🖥️  스크린: http://localhost:${PORT}/screen`);
});
