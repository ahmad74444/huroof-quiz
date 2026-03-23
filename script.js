/* ===== مسابقة حروف - Host Logic (Two Sections) ===== */

// ===== Question Registry =====
const allQuestions = {};
const usedQuestionIndices = {};

function registerLetterQuestions(letter, questions) {
    allQuestions[letter] = questions;
}

// ===== Arabic Letters =====
const ARABIC_LETTERS = [
    'أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ',
    'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص',
    'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق',
    'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'
];

// ===== Socket Connection =====
let socket;
try {
    socket = io();
    socket.on('connect', () => {
        console.log('متصل بالسيرفر:', socket.id);
    });
    socket.on('connect_error', () => {
        alert('تعذر الاتصال بالسيرفر!\n\nتأكد من تشغيل السيرفر بالأمر:\nnpm start\n\nثم افتح الصفحة من:\nhttp://localhost:3000');
    });
} catch (e) {
    alert('تعذر الاتصال بالسيرفر!');
}

// ===== Game State =====
const state = {
    roomCode: '',
    enableSection1: true,
    enableSection2: true,
    currentSection: 1,
    showQuestionToPlayers: true,
    buzzerTimeout: 15,
    team1: { name: '', score: 0 },
    team2: { name: '', score: 0 },
    players: [],
    playerScores: {},
    currentLetter: '',
    currentQuestion: null,
    questionCount: 0,
    maxQuestions: 10,
    buzzedTeam: null,
    buzzedPlayerName: '',
    secondChance: false,
    usedLetters: new Set(),
    usedLettersSection1: new Set(),
    choosingTeam: null,
    gameActive: false
};

// ===== DOM References =====
const $ = (id) => document.getElementById(id);
const screens = {
    setup: $('setup-screen'),
    lobby: $('lobby-screen'),
    letter: $('letter-screen'),
    game: $('game-screen'),
    transition: $('section-transition-screen'),
    results: $('results-screen')
};

// ===== Screen Navigation =====
function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    const heading = screens[name].querySelector('h1, h2');
    if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
    }
}

// ===== Announcer (for screen readers) =====
function announce(message) {
    const el = $('sr-announcer');
    el.textContent = '';
    setTimeout(() => { el.textContent = message; }, 100);
}

// ===== Sound Effects (real audio files) =====
const sounds = {
    correct: new Audio(encodeURI('إجابة صحيحة - مؤثر صوتي.wav')),
    wrong: new Audio(encodeURI('إجابة خاطئة - مؤثر صوتي.wav')),
    win: new Audio(encodeURI('الفوز - مؤثر صوتي.mp3')),
    buzzer: new Audio(encodeURI('صوت البوزر - مؤثر صوتي.wav'))
};

// Preload
Object.values(sounds).forEach(s => { s.load(); });

function playSound(name) {
    const s = sounds[name];
    if (s) {
        s.currentTime = 0;
        s.play().catch(() => {});
    }
}

function playCorrectSound() { playSound('correct'); }
function playWrongSound() { playSound('wrong'); }
function playBuzzerSound() { playSound('buzzer'); }
function playWinnerSound() { playSound('win'); }
function playApplauseSound() { playSound('win'); }
function playLoseSound() { playSound('wrong'); }

// ===== Microphone =====
let micStream = null;
let mediaRecorder = null;
let micActive = false;

$('btn-mic').addEventListener('click', async () => {
    if (micActive) {
        stopMic();
    } else {
        await startMic();
    }
});

async function startMic() {
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm;codecs=opus' });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                e.data.arrayBuffer().then(buf => {
                    socket.emit('mic-audio', buf);
                });
            }
        };

        // Signal players first so they prepare MediaSource before chunks arrive
        socket.emit('mic-started');
        micActive = true;
        $('btn-mic').classList.add('mic-active');
        $('mic-label').textContent = 'إيقاف المايك';

        // Small delay to let players set up, then start recording
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'inactive') {
                mediaRecorder.start(100); // send chunks every 100ms for real-time
            }
        }, 300);

        announce('تم تشغيل المايكروفون');
    } catch (err) {
        alert('تعذر الوصول للمايكروفون. تأكد من إعطاء الإذن.');
    }
}

function stopMic() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
    }
    micStream = null;
    mediaRecorder = null;
    micActive = false;
    $('btn-mic').classList.remove('mic-active');
    $('mic-label').textContent = 'المايك';
    socket.emit('mic-stopped');
    announce('تم إيقاف المايكروفون');
}

// ===== Question Visibility Toggle =====
$('toggle-show-question').addEventListener('change', () => {
    state.showQuestionToPlayers = $('toggle-show-question').checked;
    socket.emit('toggle-question-visibility', { show: state.showQuestionToPlayers });
    announce(state.showQuestionToPlayers ? 'السؤال يظهر للمتسابقين' : 'السؤال مخفي عن المتسابقين');
});

// ===== Load Letter Questions =====
function loadLetterQuestions(letter) {
    return new Promise((resolve, reject) => {
        if (allQuestions[letter]) {
            resolve(allQuestions[letter]);
            return;
        }
        const script = document.createElement('script');
        script.src = encodeURI(`مسابقة حروف/${letter}.js`);
        script.onload = () => {
            if (allQuestions[letter]) resolve(allQuestions[letter]);
            else reject(new Error(`لم يتم العثور على أسئلة الحرف: ${letter}`));
        };
        script.onerror = () => reject(new Error(`فشل تحميل ملف الأسئلة للحرف: ${letter}`));
        document.head.appendChild(script);
    });
}

// ===== Get Random Unused Question for Letter =====
function getRandomQuestion(letter) {
    const questions = allQuestions[letter];
    if (!questions) return null;

    if (!usedQuestionIndices[letter]) usedQuestionIndices[letter] = new Set();

    const available = [];
    for (let i = 0; i < questions.length; i++) {
        if (!usedQuestionIndices[letter].has(i)) available.push(i);
    }

    if (available.length === 0) {
        usedQuestionIndices[letter].clear();
        for (let i = 0; i < questions.length; i++) available.push(i);
    }

    const idx = available[Math.floor(Math.random() * available.length)];
    usedQuestionIndices[letter].add(idx);
    return questions[idx];
}

// ===== Section Mode Select =====
function updateSectionMode() {
    const mode = $('section-mode').value;
    state.enableSection1 = (mode === 'both' || mode === 'section1');
    state.enableSection2 = (mode === 'both' || mode === 'section2');

    $('teams-setup-area').style.display = state.enableSection2 ? 'flex' : 'none';
    $('max-questions-area').style.display = state.enableSection2 ? 'block' : 'none';
}

$('section-mode').addEventListener('change', updateSectionMode);

// ===== Create Room =====
$('create-room-btn').addEventListener('click', () => {
    updateSectionMode();

    if (state.enableSection2) {
        const name1 = $('team1-name').value.trim();
        const name2 = $('team2-name').value.trim();
        if (!name1 || !name2) {
            alert('يرجى إدخال أسماء الفريقين');
            if (!name1) $('team1-name').focus();
            else $('team2-name').focus();
            return;
        }
        state.team1.name = name1;
        state.team2.name = name2;
        state.maxQuestions = parseInt($('max-questions').value);
    } else {
        state.team1.name = '';
        state.team2.name = '';
    }

    state.buzzerTimeout = parseInt($('buzzer-timeout').value) || 0;

    socket.emit('create-room', {
        team1Name: state.team1.name,
        team2Name: state.team2.name,
        maxQuestions: state.maxQuestions,
        enableSection1: state.enableSection1,
        enableSection2: state.enableSection2,
        buzzerTimeout: state.buzzerTimeout
    });
});

socket.on('room-created', async ({ code }) => {
    state.roomCode = code;
    $('room-code-display').textContent = code;

    let shareLink;
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
        try {
            const resp = await fetch('/api/server-info');
            const info = await resp.json();
            shareLink = `http://${info.ip}:${info.port}/player.html?room=${code}`;
        } catch (e) {
            shareLink = `${window.location.origin}/player.html?room=${code}`;
        }
    } else {
        shareLink = `${window.location.origin}/player.html?room=${code}`;
    }

    $('network-link-display').href = shareLink;
    $('network-link-display').textContent = shareLink;
    $('network-link-area').hidden = false;

    showScreen('lobby');
    announce(`تم إنشاء الغرفة. الرمز: ${code.split('').join(' ')}`);
});

$('copy-code-btn').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(state.roomCode);
        $('copy-code-btn').textContent = '✅ تم النسخ!';
    } catch (e) {
        prompt('انسخ الرمز:', state.roomCode);
    }
    setTimeout(() => { $('copy-code-btn').textContent = '📋 نسخ الرمز'; }, 2000);
});

$('copy-link-btn').addEventListener('click', async () => {
    const link = $('network-link-display').href;
    try {
        await navigator.clipboard.writeText(link);
        $('copy-link-btn').textContent = '✅ تم النسخ!';
    } catch (e) {
        prompt('انسخ الرابط:', link);
    }
    setTimeout(() => { $('copy-link-btn').textContent = '🔗 نسخ رابط الانضمام'; }, 2000);
});

// ===== Player Joined =====
socket.on('player-joined', ({ playerName, team, players }) => {
    state.players = players;
    renderPlayersList();
    if (state.enableSection2) {
        const teamName = team === 1 ? state.team1.name : state.team2.name;
        announce(`${playerName} انضم إلى الفريق ${teamName}`);
    } else {
        announce(`${playerName} انضم للمسابقة`);
    }
});

socket.on('player-left', ({ playerName, players }) => {
    state.players = players;
    renderPlayersList();
});

function renderPlayersList() {
    const list = $('players-list');
    if (state.players.length === 0) {
        list.innerHTML = '<p class="no-players">في انتظار انضمام المتسابقين...</p>';
        return;
    }

    if (state.enableSection2) {
        const team1Players = state.players.filter(p => p.team === 1);
        const team2Players = state.players.filter(p => p.team === 2);

        list.innerHTML = `
            <div class="player-group">
                <h4 style="color: var(--team1-light);">${state.team1.name} (${team1Players.length})</h4>
                ${team1Players.map(p => `<span class="player-tag team1-tag">${p.name}</span>`).join('')}
                ${team1Players.length === 0 ? '<span class="no-players-sm">لا يوجد لاعبين</span>' : ''}
            </div>
            <div class="player-group">
                <h4 style="color: var(--team2-light);">${state.team2.name} (${team2Players.length})</h4>
                ${team2Players.map(p => `<span class="player-tag team2-tag">${p.name}</span>`).join('')}
                ${team2Players.length === 0 ? '<span class="no-players-sm">لا يوجد لاعبين</span>' : ''}
            </div>
        `;
    } else {
        list.innerHTML = state.players.map(p =>
            `<span class="player-tag">${p.name}</span>`
        ).join('');
    }
}

// ===== Update Section Indicators =====
function updateSectionIndicators() {
    const section = state.currentSection;
    const text = section === 1 ? '📢 القسم الأول: مسابقة عامة' : '👥 القسم الثاني: مسابقة فريقين';
    const textSm = section === 1 ? '📢 عام' : '👥 فريقين';

    $('current-section-indicator').textContent = text;
    $('current-section-indicator').className = `current-section-badge section-${section}`;
    $('game-section-indicator').textContent = textSm;
    $('game-section-indicator').className = `current-section-badge-sm section-${section}`;

    $('end-section1-btn').style.display = (section === 1 && state.enableSection2) ? 'inline-flex' : 'none';
    $('sound-controls').hidden = section !== 1;
}

// ===== Start Game =====
$('start-game-btn').addEventListener('click', () => {
    socket.emit('start-game');
    state.gameActive = true;
    state.questionCount = 0;
    state.team1.score = 0;
    state.team2.score = 0;
    state.playerScores = {};
    state.usedLetters.clear();
    state.usedLettersSection1.clear();
    state.choosingTeam = null;

    if (state.enableSection1) {
        state.currentSection = 1;
        updateSectionIndicators();
        updateAllScoreDisplays();
        generateLetterGrid();

        $('letter-screen-title').textContent = 'اختر حرفاً للسؤال الأول';
        $('letter-screen-subtitle').textContent = 'القسم الأول: المسابقة العامة';
        $('question-progress').textContent = '';

        showScreen('letter');
        announce('بدأت المسابقة! القسم الأول: المسابقة العامة. اختر حرفاً.');
    } else {
        state.currentSection = 2;
        updateSectionIndicators();
        updateAllScoreDisplays();
        generateLetterGrid();

        $('letter-screen-title').textContent = 'اختر حرفاً للسؤال الأول';
        $('letter-screen-subtitle').textContent = 'القسم الثاني: مسابقة الفريقين';
        $('question-progress').textContent = `السؤال 1 من ${state.maxQuestions}`;

        showScreen('letter');
        announce('بدأت المسابقة! مسابقة الفريقين. اختر حرفاً.');
    }
});

// ===== Update Team Names =====
function updateTeamNames() {
    const n1 = state.team1.name;
    const n2 = state.team2.name;
    if ($('score-team1-name')) $('score-team1-name').textContent = n1;
    if ($('score-team2-name')) $('score-team2-name').textContent = n2;
    if ($('game-team1-name')) $('game-team1-name').textContent = n1;
    if ($('game-team2-name')) $('game-team2-name').textContent = n2;
    if ($('result-team1-name')) $('result-team1-name').textContent = n1;
    if ($('result-team2-name')) $('result-team2-name').textContent = n2;
}

// ===== Update Scores =====
function updateAllScoreDisplays() {
    if (state.currentSection === 1) {
        const sorted = getPlayerRanking();
        const scoreboardEl = $('letter-scoreboard');
        const scoreboardSmEl = $('game-scoreboard');

        if (scoreboardEl) {
            scoreboardEl.innerHTML = sorted.slice(0, 3).map((p, i) =>
                `<div class="score-item"><span class="score-team-name" style="color: var(--gold-light);">${['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'][i] || ''} ${p.name}</span><span class="score-value" style="color: var(--gold);">${p.score}</span></div>`
            ).join('<div class="score-divider" aria-hidden="true">|</div>') || '<div class="score-item"><span class="score-team-name">لا توجد نقاط بعد</span></div>';
        }
        if (scoreboardSmEl) {
            scoreboardSmEl.innerHTML = sorted.slice(0, 3).map((p, i) =>
                `<div class="score-item"><span class="score-team-name" style="color: var(--gold-light);">${['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'][i] || ''} ${p.name}</span><span class="score-value" style="color: var(--gold);">${p.score}</span></div>`
            ).join('<div class="score-divider" aria-hidden="true">|</div>') || '';
        }
    } else {
        const s1 = state.team1.score;
        const s2 = state.team2.score;
        const scoreboardEl = $('letter-scoreboard');
        const scoreboardSmEl = $('game-scoreboard');

        if (scoreboardEl) {
            scoreboardEl.innerHTML = `
                <div class="score-item team1-score">
                    <span class="score-team-name" id="score-team1-name">${state.team1.name}</span>
                    <span class="score-value" id="score-team1-value">${s1}</span>
                </div>
                <div class="score-divider" aria-hidden="true">:</div>
                <div class="score-item team2-score">
                    <span class="score-value" id="score-team2-value">${s2}</span>
                    <span class="score-team-name" id="score-team2-name">${state.team2.name}</span>
                </div>
            `;
        }
        if (scoreboardSmEl) {
            scoreboardSmEl.innerHTML = `
                <div class="score-item team1-score">
                    <span class="score-team-name" id="game-team1-name">${state.team1.name}</span>
                    <span class="score-value" id="game-team1-score">${s1}</span>
                </div>
                <div class="score-divider" aria-hidden="true">:</div>
                <div class="score-item team2-score">
                    <span class="score-value" id="game-team2-score">${s2}</span>
                    <span class="score-team-name" id="game-team2-name">${state.team2.name}</span>
                </div>
            `;
        }
    }
}

function getPlayerRanking() {
    return Object.values(state.playerScores)
        .sort((a, b) => b.score - a.score);
}

// ===== Letter Grid =====
function generateLetterGrid() {
    const grid = $('letters-grid');
    grid.innerHTML = '';
    ARABIC_LETTERS.forEach(letter => {
        const btn = document.createElement('button');
        btn.className = 'letter-btn';
        btn.textContent = letter;
        btn.setAttribute('aria-label', `حرف ${letter}`);
        if (state.usedLetters.has(letter)) {
            btn.classList.add('used');
            btn.setAttribute('aria-disabled', 'true');
        }
        btn.addEventListener('click', () => selectLetter(letter));
        grid.appendChild(btn);
    });
}

// ===== Select Letter =====
async function selectLetter(letter) {
    if (state.usedLetters.has(letter)) return;

    try {
        await loadLetterQuestions(letter);
        const q = getRandomQuestion(letter);
        if (!q) {
            alert('لا توجد أسئلة متاحة لهذا الحرف');
            return;
        }

        state.currentLetter = letter;
        state.currentQuestion = q;
        state.usedLetters.add(letter);
        state.buzzedTeam = null;
        state.buzzedPlayerName = '';
        state.secondChance = false;

        socket.emit('send-question', {
            letter,
            question: q.q,
            answer: q.a
        });

        state.questionCount++;
        $('current-letter-display').textContent = letter;

        if (state.currentSection === 1) {
            $('question-counter').textContent = `السؤال ${state.questionCount}`;
        } else {
            $('question-counter').textContent = `السؤال ${state.questionCount} من ${state.maxQuestions}`;
        }

        $('question-text').textContent = q.q;
        $('answer-text').textContent = q.a;

        $('answer-area').hidden = true;
        $('buzzer-result').hidden = true;
        $('buzzer-result').className = 'buzzer-result';
        $('host-controls').hidden = true;
        $('waiting-buzz').hidden = false;
        $('waiting-buzz').querySelector('.waiting-text').textContent = '⏳ في انتظار ضغط البازر من المتسابقين...';

        // Start countdown timer
        startQuestionTimer();

        updateSectionIndicators();
        showScreen('game');
        announce(`حرف ${letter}. السؤال ${state.questionCount}: ${q.q}`);
    } catch (err) {
        alert(err.message);
    }
}

// ===== Question Timer =====
let timerInterval = null;
let timerTimeLeft = 0;
let timerTotalTime = 0;
let timerPaused = false;
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 54; // 339.292

function startQuestionTimer() {
    stopQuestionTimer();
    if (!state.buzzerTimeout || state.buzzerTimeout <= 0) {
        $('question-timer').hidden = true;
        return;
    }

    timerTotalTime = state.buzzerTimeout;
    timerTimeLeft = timerTotalTime;
    timerPaused = false;
    $('question-timer').hidden = false;
    $('btn-timer-pause').textContent = '⏸';
    $('btn-timer-pause').classList.remove('paused');
    updateTimerDisplay();

    timerInterval = setInterval(() => {
        if (timerPaused) return;
        timerTimeLeft--;
        updateTimerDisplay();

        if (timerTimeLeft <= 0) {
            stopQuestionTimer();
            onBuzzerTimeout();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const numEl = $('timer-number');
    const progressEl = $('timer-progress');
    numEl.textContent = Math.max(0, timerTimeLeft);

    // Update circular progress
    const fraction = timerTotalTime > 0 ? timerTimeLeft / timerTotalTime : 0;
    const offset = TIMER_CIRCUMFERENCE * (1 - fraction);
    progressEl.style.strokeDasharray = TIMER_CIRCUMFERENCE;
    progressEl.style.strokeDashoffset = offset;

    // Urgent styling when <= 5 seconds
    if (timerTimeLeft <= 5) {
        numEl.classList.add('timer-urgent');
        progressEl.classList.add('timer-urgent');
    } else {
        numEl.classList.remove('timer-urgent');
        progressEl.classList.remove('timer-urgent');
    }
}

function stopQuestionTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    $('question-timer').hidden = true;
    timerPaused = false;
}

// Timer controls
$('btn-timer-pause').addEventListener('click', () => {
    timerPaused = !timerPaused;
    if (timerPaused) {
        $('btn-timer-pause').textContent = '▶';
        $('btn-timer-pause').classList.add('paused');
        announce('تم إيقاف المؤقت');
    } else {
        $('btn-timer-pause').textContent = '⏸';
        $('btn-timer-pause').classList.remove('paused');
        announce('تم استئناف المؤقت');
    }
});

$('btn-timer-plus').addEventListener('click', () => {
    timerTimeLeft += 5;
    timerTotalTime += 5;
    updateTimerDisplay();
    announce('تم إضافة 5 ثواني');
});

$('btn-timer-minus').addEventListener('click', () => {
    timerTimeLeft = Math.max(1, timerTimeLeft - 5);
    updateTimerDisplay();
    announce('تم إنقاص 5 ثواني');
});

function onBuzzerTimeout() {
    // Time expired and nobody buzzed
    $('waiting-buzz').hidden = true;
    $('host-controls').hidden = true;

    if (state.secondChance) {
        // Second chance also timed out
        socket.emit('judge-wrong');
        $('answer-area').hidden = false;
        announce('انتهى الوقت! الجواب: ' + state.currentQuestion.a);

        if (state.currentSection === 2 && state.questionCount >= state.maxQuestions) {
            setTimeout(() => endGame(), 2000);
        } else {
            state.choosingTeam = null;
            setTimeout(() => showLetterSelection(), 2000);
        }
    } else {
        // First timeout
        socket.emit('skip-question');
        $('answer-area').hidden = false;
        announce('انتهى الوقت! تم تخطي السؤال. الجواب: ' + state.currentQuestion.a);

        if (state.currentSection === 2 && state.questionCount >= state.maxQuestions) {
            setTimeout(() => endGame(), 2000);
        } else {
            state.choosingTeam = null;
            setTimeout(() => showLetterSelection(), 2000);
        }
    }
}

// ===== Handle Player Buzz =====
socket.on('player-buzzed', ({ playerName, team, teamName }) => {
    state.buzzedTeam = team;
    state.buzzedPlayerName = playerName;
    playBuzzerSound();
    stopQuestionTimer();

    $('waiting-buzz').hidden = true;

    const resultEl = $('buzzer-result');
    resultEl.hidden = false;

    if (state.currentSection === 1) {
        resultEl.className = 'buzzer-result general-buzzed';
        $('buzzer-result-text').textContent = `🔔 ${playerName} ضغط البازر!`;
    } else {
        resultEl.className = `buzzer-result team${team}-buzzed`;
        $('buzzer-result-text').textContent = `🔔 ${playerName} (${teamName}) ضغط البازر!`;
    }

    $('host-controls').hidden = false;
    $('btn-show-answer').focus();

    announce(`${playerName} ضغط البازر`);
});

// ===== Host Controls =====
$('btn-show-answer').addEventListener('click', () => {
    $('answer-area').hidden = false;
    socket.emit('show-answer');
    announce(`الجواب: ${state.currentQuestion.a}`);
});

$('btn-correct').addEventListener('click', () => {
    playCorrectSound();
    socket.emit('play-sound', { sound: 'correct' });

    if (state.currentSection === 1) {
        socket.emit('judge-correct');
    } else {
        if (!state.buzzedTeam) return;
        const team = state.buzzedTeam === 1 ? state.team1 : state.team2;
        team.score++;
        updateAllScoreDisplays();
        socket.emit('judge-correct');
        announce(`إجابة صحيحة! نقطة لـ ${team.name}`);
    }

    $('host-controls').hidden = true;
    $('answer-area').hidden = false;

    if (state.currentSection === 2 && state.questionCount >= state.maxQuestions) {
        setTimeout(() => endGame(), 2000);
    } else {
        if (state.currentSection === 2) {
            state.choosingTeam = state.buzzedTeam;
        }
        setTimeout(() => showLetterSelection(), 2000);
    }
});

$('btn-wrong').addEventListener('click', () => {
    playWrongSound();
    socket.emit('play-sound', { sound: 'wrong' });

    if (state.currentSection === 1) {
        socket.emit('judge-wrong');
        $('host-controls').hidden = true;
        $('buzzer-result').hidden = true;
        $('waiting-buzz').hidden = false;
        $('waiting-buzz').querySelector('.waiting-text').textContent =
            `❌ ${state.buzzedPlayerName} أخطأ! الفرصة للباقي...`;
        state.buzzedTeam = null;
        state.buzzedPlayerName = '';
        startQuestionTimer();
        announce('إجابة خاطئة. الفرصة للباقي');
    } else {
        if (!state.buzzedTeam) return;

        if (!state.secondChance) {
            state.secondChance = true;
            socket.emit('judge-wrong');

            const wrongTeamName = state.buzzedTeam === 1 ? state.team1.name : state.team2.name;
            const otherTeam = state.buzzedTeam === 1 ? 2 : 1;
            const otherName = otherTeam === 1 ? state.team1.name : state.team2.name;

            state.buzzedTeam = null;
            $('host-controls').hidden = true;
            $('buzzer-result').hidden = true;
            $('waiting-buzz').hidden = false;
            $('waiting-buzz').querySelector('.waiting-text').textContent =
                `❌ ${wrongTeamName} أخطأ! الفرصة لـ ${otherName}...`;
            startQuestionTimer();

            announce(`إجابة خاطئة من ${wrongTeamName}. الفرصة لـ ${otherName}`);
        } else {
            socket.emit('judge-wrong');
            $('host-controls').hidden = true;
            $('answer-area').hidden = false;
            announce(`إجابة خاطئة. الجواب: ${state.currentQuestion.a}`);

            if (state.questionCount >= state.maxQuestions) {
                setTimeout(() => endGame(), 2000);
            } else {
                state.choosingTeam = null;
                setTimeout(() => showLetterSelection(), 2000);
            }
        }
    }
});

$('btn-skip').addEventListener('click', () => {
    socket.emit('skip-question');
    stopQuestionTimer();

    $('host-controls').hidden = true;
    $('waiting-buzz').hidden = true;
    $('answer-area').hidden = false;
    announce(`تم تخطي السؤال. الجواب: ${state.currentQuestion.a}`);

    if (state.currentSection === 2 && state.questionCount >= state.maxQuestions) {
        setTimeout(() => endGame(), 2000);
    } else {
        state.choosingTeam = null;
        setTimeout(() => showLetterSelection(), 2000);
    }
});

// ===== Sound Effect Buttons (Section 1 only) =====
$('btn-sound-win').addEventListener('click', () => {
    playWinnerSound();
    socket.emit('play-sound', { sound: 'win' });
});

$('btn-sound-lose').addEventListener('click', () => {
    playLoseSound();
    socket.emit('play-sound', { sound: 'lose' });
});

$('btn-sound-applause').addEventListener('click', () => {
    playApplauseSound();
    socket.emit('play-sound', { sound: 'applause' });
});

// ===== Server score update for general mode =====
socket.on('score-updated', ({ playerScores }) => {
    if (playerScores) {
        state.playerScores = playerScores;
        updateAllScoreDisplays();
    }
});

// ===== Handle all-wrong in general mode =====
socket.on('all-players-wrong', () => {
    $('host-controls').hidden = true;
    $('waiting-buzz').hidden = true;
    $('buzzer-result').hidden = true;
    $('answer-area').hidden = false;

    announce('جميع المتسابقين أخطأوا. الجواب: ' + state.currentQuestion.a);

    setTimeout(() => showLetterSelection(), 2000);
});

// ===== Show Letter Selection =====
function showLetterSelection() {
    generateLetterGrid();
    updateSectionIndicators();

    if (state.currentSection === 1) {
        $('question-progress').textContent = '';
        $('letter-screen-title').textContent = 'اختر حرفاً';
        $('letter-screen-subtitle').textContent = 'القسم الأول: المسابقة العامة';
    } else {
        const nextNum = state.questionCount + 1;
        $('question-progress').textContent = `السؤال ${nextNum} من ${state.maxQuestions}`;

        if (state.choosingTeam) {
            const teamName = state.choosingTeam === 1 ? state.team1.name : state.team2.name;
            $('letter-screen-title').textContent = `${teamName} يختار الحرف`;
            $('letter-screen-subtitle').textContent = 'الفريق الفائز بالسؤال السابق يختار الحرف التالي';
        } else {
            $('letter-screen-title').textContent = 'اختر حرفاً';
            $('letter-screen-subtitle').textContent = 'اختر حرفاً للسؤال التالي';
        }
    }

    updateAllScoreDisplays();
    showScreen('letter');
}

// ===== End Section 1 -> Transition to Section 2 =====
$('end-section1-btn').addEventListener('click', () => {
    if (confirm('هل تريد إنهاء القسم الأول والانتقال لمسابقة الفريقين؟')) {
        transitionToSection2();
    }
});

function transitionToSection2() {
    state.usedLettersSection1 = new Set(state.usedLetters);

    $('transition-team1').textContent = state.team1.name;
    $('transition-team2').textContent = state.team2.name;

    socket.emit('switch-section');

    showScreen('transition');
    announce('انتهى القسم الأول. القسم الثاني: مسابقة الفريقين.');
}

$('btn-start-section2').addEventListener('click', () => {
    state.currentSection = 2;
    state.questionCount = 0;
    state.team1.score = 0;
    state.team2.score = 0;
    state.usedLetters.clear();
    state.choosingTeam = null;

    updateSectionIndicators();
    updateAllScoreDisplays();
    generateLetterGrid();

    $('letter-screen-title').textContent = 'اختر حرفاً للسؤال الأول';
    $('letter-screen-subtitle').textContent = 'القسم الثاني: مسابقة الفريقين';
    $('question-progress').textContent = `السؤال 1 من ${state.maxQuestions}`;

    socket.emit('start-section2');

    showScreen('letter');
    announce('بدأ القسم الثاني! مسابقة الفريقين. اختر حرفاً.');
});

// ===== End Game =====
$('end-game-early-btn').addEventListener('click', () => {
    if (confirm('هل تريد إنهاء المسابقة؟')) {
        endGame();
    }
});

function endGame() {
    state.gameActive = false;
    socket.emit('end-game');

    if (state.currentSection === 1) {
        const sorted = getPlayerRanking();
        $('team-results-area').hidden = true;
        const rankArea = $('ranking-list-area');
        rankArea.hidden = false;

        if (sorted.length === 0) {
            rankArea.innerHTML = '<p>لا توجد نتائج</p>';
        } else {
            const medals = ['\ud83e\udd47', '\ud83e\udd48', '\ud83e\udd49'];
            rankArea.innerHTML = sorted.map((p, i) =>
                `<div class="ranking-item ${i === 0 ? 'ranking-first' : ''}">
                    <span class="ranking-position">${medals[i] || (i + 1)}</span>
                    <span class="ranking-name">${p.name}</span>
                    <span class="ranking-score">${p.score} نقاط</span>
                </div>`
            ).join('');
        }

        $('results-title').textContent = 'انتهت المسابقة';
        $('results-subtitle').textContent = 'القسم الأول: المسابقة العامة';
        $('results-icon').textContent = '\ud83c\udfc6';

        // Play win sound for ending general section
        playWinnerSound();
        socket.emit('play-sound', { sound: 'win' });
    } else {
        $('team-results-area').hidden = false;
        $('ranking-list-area').hidden = true;

        const s1 = state.team1.score;
        const s2 = state.team2.score;

        $('result-team1-name').textContent = state.team1.name;
        $('result-team2-name').textContent = state.team2.name;
        $('result-team1-score').textContent = s1;
        $('result-team2-score').textContent = s2;
        $('result-team1').classList.remove('winner');
        $('result-team2').classList.remove('winner');

        let title, subtitle, icon;
        if (s1 > s2) {
            title = `\ud83c\udf89 فاز ${state.team1.name}!`;
            subtitle = `بنتيجة ${s1} مقابل ${s2}`;
            icon = '\ud83c\udfc6';
            $('result-team1').classList.add('winner');
        } else if (s2 > s1) {
            title = `\ud83c\udf89 فاز ${state.team2.name}!`;
            subtitle = `بنتيجة ${s2} مقابل ${s1}`;
            icon = '\ud83c\udfc6';
            $('result-team2').classList.add('winner');
        } else {
            title = '\ud83e\udd1d تعادل!';
            subtitle = `النتيجة ${s1} - ${s2}`;
            icon = '\ud83e\udd1d';
        }

        $('results-title').textContent = title;
        $('results-subtitle').textContent = subtitle;
        $('results-icon').textContent = icon;

        playApplauseSound();
        playWinnerSound();
        socket.emit('play-sound', { sound: 'win' });
    }

    showScreen('results');
    announce($('results-title').textContent + '. ' + $('results-subtitle').textContent);
}

// ===== New Game =====
$('btn-new-game').addEventListener('click', () => {
    state.currentSection = state.enableSection1 ? 1 : 2;
    state.team1.score = 0;
    state.team2.score = 0;
    state.usedLetters.clear();
    state.usedLettersSection1.clear();
    state.questionCount = 0;
    state.choosingTeam = null;
    state.playerScores = {};
    Object.keys(usedQuestionIndices).forEach(k => delete usedQuestionIndices[k]);

    socket.emit('new-game');
    renderPlayersList();
    showScreen('lobby');
    announce('مسابقة جديدة. في انتظار البدء.');
});

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    if ($('team1-name')) $('team1-name').focus();
});
