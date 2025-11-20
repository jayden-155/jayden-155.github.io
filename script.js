// --- IndexedDB Database Layer (No Framework) ---
const DB_NAME = 'FitnessTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'appState';

const db = {
    open: () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME);
                }
            };
            
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    },
    
    save: async (state) => {
        const database = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(state, 'currentState');
            
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },
    
    load: async () => {
        const database = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get('currentState');
            
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },
    
    clear: async () => {
        const database = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
        });
    }
};

// --- Utilities ---
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// Security: Sanitize Input
function escapeHtml(text) {
    if (!text) return text;
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Performance: Debounce Function
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

function attachListener(id, event, handler) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, handler);
    }
}

// --- State Management ---
let state = {
    exercises: [],
    programs: [],
    currentProgram: null,
    currentWeek: 1,
    workoutHistory: [],
    activeWorkout: null,
    editingProgram: null,
    editingWorkout: null,
    selectedExerciseCallback: null,
    restTimerInterval: null,
    restTime: 0
};

// Initialize with Async DB
async function initializeApp() {
    try {
        const savedState = await db.load();
        
        if (savedState) {
            state = { ...state, ...savedState };
        } else {
            // Fallback/Legacy
            const legacyData = localStorage.getItem('fitnessTrackerState');
            if (legacyData) {
                state = { ...state, ...JSON.parse(legacyData) };
                await db.save(state);
                localStorage.removeItem('fitnessTrackerState');
            }
        }

        // Default exercises (Updated to new Specific Categories)
        if (!state.exercises || state.exercises.length === 0) {
            state.exercises = [
                { id: 1, name: 'Barbell Bench Press', category: 'Chest' },
                { id: 2, name: 'Squat', category: 'Quadriceps' },
                { id: 3, name: 'Deadlift', category: 'Hamstrings' },
                { id: 4, name: 'Overhead Press', category: 'Shoulders' },
                { id: 5, name: 'Dumbbell Row', category: 'Lats' },
                { id: 6, name: 'Pull-ups', category: 'Lats' },
                { id: 7, name: 'Dips', category: 'Triceps' },
                { id: 8, name: 'Bicep Curl', category: 'Biceps' },
                { id: 9, name: 'Tricep Pushdown', category: 'Triceps' },
                { id: 10, name: 'Leg Press', category: 'Quadriceps' },
                { id: 11, name: 'Calf Raise', category: 'Calves' },
                { id: 12, name: 'Lateral Raise', category: 'Shoulders' }
            ];
            await db.save(state);
        }
        
        // Render UI
        initializeTabs();
        initializeLibraryTabs();
        resetLibraryTabs(); // Force UI to consistent state
        initializeModals();
        renderTrainingTab();
        renderProgramsList();
        renderExercisesList();
        console.log("Fitness Tracker Initialized");
        
    } catch (err) {
        console.error("Init failed:", err);
    }
}

// Save Wrapper
async function saveState() {
    const stateToSave = {
        exercises: state.exercises,
        programs: state.programs,
        currentProgram: state.currentProgram,
        currentWeek: state.currentWeek,
        workoutHistory: state.workoutHistory,
        activeWorkout: state.activeWorkout
    };
    await db.save(stateToSave);
}

// Debounced save
const debouncedSaveState = debounce(saveState, 1000);

window.resetApp = async function() {
    if(confirm("Are you sure you want to wipe all data? This cannot be undone.")) {
        await db.clear();
        location.reload();
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);

// --- Tabs ---
function initializeTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(tabName).classList.add('active');
            
            // Special fix: If user goes to Library, reset sub-tabs
            if(tabName === 'library') {
                resetLibraryTabs();
            }
        });
    });
}

// FIX: Logic to prevent both showing at once
function resetLibraryTabs() {
    const programContent = document.getElementById('programs');
    const exerciseContent = document.getElementById('exercises');
    const programBtn = document.querySelector('[data-library-tab="programs"]');
    const exerciseBtn = document.querySelector('[data-library-tab="exercises"]');
    
    // Default to Programs Open
    if (programContent && exerciseContent) {
        programContent.classList.add('active');
        programContent.style.display = 'block';
        exerciseContent.classList.remove('active');
        exerciseContent.style.display = 'none';
    }
    
    if (programBtn && exerciseBtn) {
        programBtn.classList.add('active');
        exerciseBtn.classList.remove('active');
    }
}

function initializeLibraryTabs() {
    const libraryTabBtns = document.querySelectorAll('.library-tab-btn');
    const libraryContents = document.querySelectorAll('.library-content');
    
    libraryTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.libraryTab;
            
            // Update Buttons
            libraryTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update Content Visibility
            libraryContents.forEach(content => {
                content.classList.remove('active');
                content.style.display = 'none'; // Force hide
            });
            
            const targetEl = document.getElementById(targetId);
            if(targetEl) {
                targetEl.classList.add('active');
                targetEl.style.display = 'block'; // Force show
            }
        });
    });
}

// --- Modals & Event Listeners ---
function initializeModals() {
    // Program Builder
    attachListener('createProgramBtn', 'click', () => openProgramBuilder());
    attachListener('closeProgramModal', 'click', closeProgramBuilder);
    attachListener('cancelProgramBtn', 'click', closeProgramBuilder);
    attachListener('saveProgramBtn', 'click', saveProgram);
    attachListener('addWorkoutBtn', 'click', addWorkoutToProgram);
    
    // Workout Builder
    attachListener('closeWorkoutModal', 'click', closeWorkoutBuilder);
    attachListener('cancelWorkoutBtn', 'click', closeWorkoutBuilder);
    attachListener('saveWorkoutBtn', 'click', saveWorkout);
    attachListener('addExerciseToWorkoutBtn', 'click', () => openExerciseSelection('workoutBuilder'));
    
    // Exercise Selection
    attachListener('closeExerciseSelectionModal', 'click', closeExerciseSelection);
    attachListener('exerciseSelectionSearch', 'input', filterExerciseSelection);
    
    // Add Exercise (Library)
    attachListener('createExerciseBtn', 'click', openAddExercise);
    attachListener('closeAddExerciseModal', 'click', closeAddExercise);
    attachListener('cancelExerciseBtn', 'click', closeAddExercise);
    attachListener('saveExerciseBtn', 'click', saveExercise);
    
    // Active Workout (Logging)
    attachListener('closeActiveWorkoutModal', 'click', closeActiveWorkout); 
    attachListener('finishWorkoutBtn', 'click', finishWorkout);
    attachListener('discardWorkoutBtn', 'click', discardWorkout); 
    attachListener('addExerciseToActiveBtn', 'click', () => openExerciseSelection('activeWorkout'));
    attachListener('restTimerBtn', 'click', startRestTimer);
    attachListener('stopTimerBtn', 'click', stopRestTimer);
    
    // Notes Listener
    attachListener('workoutNotes', 'input', (e) => {
        if(state.activeWorkout) {
            state.activeWorkout.notes = e.target.value;
            debouncedSaveState();
        }
    });

    // History Modal
    attachListener('openHistoryBtn', 'click', openHistoryModal);
    attachListener('closeHistoryModal', 'click', closeHistoryModal);
    
    // Dashboard
    attachListener('selectProgramBtn', 'click', () => {
        const libBtn = document.querySelector('.tab-btn[data-tab="library"]');
        if(libBtn) libBtn.click();
    });
    attachListener('quickLogBtn', 'click', startQuickWorkout);
    
    // Search
    attachListener('exerciseSearch', 'input', filterExercises);
}

// --- History Logic (Now a Modal) ---
function openHistoryModal() {
    document.getElementById('historyModal').classList.add('active');
    renderHistory();
}

function closeHistoryModal() {
    document.getElementById('historyModal').classList.remove('active');
}

function renderHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    
    if (state.workoutHistory.length === 0) {
        list.innerHTML = '<div class="empty-state">No history yet.</div>';
        return;
    }
    
    const sorted = [...state.workoutHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    sorted.forEach(record => {
        const date = new Date(record.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const duration = record.durationSeconds ? `${Math.floor(record.durationSeconds / 60)}m` : '';
        const notesHTML = record.notes ? `<div style="margin-top:8px; padding:10px; background:var(--surface-highlight); border-radius:8px; font-size:13px; font-style:italic; color:var(--text-secondary);">"${escapeHtml(record.notes)}"</div>` : '';

        const card = document.createElement('div');
        card.className = 'card';
        
        let exercisesHTML = '';
        record.exercises.forEach(ex => {
            const exerciseData = state.exercises.find(e => e.id === ex.exerciseId);
            if(!exerciseData) return;
            
            const bestSet = ex.sets.reduce((max, curr) => Number(curr.weight) > Number(max.weight) ? curr : max, ex.sets[0]);
            
            exercisesHTML += `
                <div class="flex justify-between text-sm mt-2 border-bottom" style="border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:8px;">
                    <span class="text-secondary">${escapeHtml(exerciseData.name)}</span>
                    <span>${ex.sets.length} sets • Best: ${bestSet ? bestSet.weight : 0}</span>
                </div>
            `;
        });
        
        card.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <h3 style="font-size:16px;">${escapeHtml(record.name)} ${duration ? `<span style="font-weight:400; color:var(--text-secondary); font-size:12px;">(${duration})</span>` : ''}</h3>
                <span class="text-secondary text-sm">${date}</span>
            </div>
            <div style="max-height: 150px; overflow-y:auto;">
                ${exercisesHTML}
            </div>
            ${notesHTML}
        `;
        list.appendChild(card);
    });
}

// --- Training Tab Logic ---
function renderTrainingTab() {
    const container = document.getElementById('training');
    const programNameEl = document.getElementById('programName');
    const programWeekEl = document.getElementById('programWeek');
    const workoutListEl = document.getElementById('workoutList');
    
    if(!container) return;

    // 1. Check for Resume Card
    const resumeCardId = 'resumeWorkoutCard';
    let resumeCard = document.getElementById(resumeCardId);
    
    if (state.activeWorkout) {
        if (!resumeCard) {
            resumeCard = document.createElement('div');
            resumeCard.id = resumeCardId;
            resumeCard.className = 'resume-card';
            // Insert after header
            const header = container.querySelector('.header');
            header.after(resumeCard);
        }
        
        resumeCard.innerHTML = `
            <div class="flex justify-between items-center">
                <div>
                    <div style="font-size:12px; color:var(--warning); font-weight:bold; margin-bottom:4px;">IN PROGRESS</div>
                    <h3 style="margin:0;">${escapeHtml(state.activeWorkout.name)}</h3>
                    <p style="font-size:13px; color:var(--text-secondary); margin-top:4px;">
                        ${state.activeWorkout.isPaused ? 'Paused' : 'Tap to resume'}
                    </p>
                </div>
                <button class="btn-icon-sm" style="background:var(--warning); color:black; border:none;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </button>
            </div>
        `;
        resumeCard.onclick = () => openActiveWorkout();
    } else {
        if (resumeCard) resumeCard.remove();
    }

    // 2. Render Program Info
    if (!state.currentProgram) {
        programNameEl.textContent = 'No Program Selected';
        programWeekEl.textContent = 'Go to Library to select or create a program.';
        workoutListEl.innerHTML = '<div class="empty-state">Select a program in the Library to see your daily workouts here.</div>';
        return;
    }
    
    const program = state.programs.find(p => p.id === state.currentProgram);
    if (!program) {
        state.currentProgram = null;
        saveState();
        renderTrainingTab();
        return;
    }
    
    programNameEl.textContent = escapeHtml(program.name);
    programWeekEl.textContent = `Week ${state.currentWeek} • ${program.weeks} Weeks Total`;
    
    workoutListEl.innerHTML = '';
    
    if(program.workouts.length === 0) {
        workoutListEl.innerHTML = '<div class="empty-state">This program has no workouts yet. Edit it in the Library.</div>';
        return;
    }

    program.workouts.forEach((workout, index) => {
        const card = document.createElement('div');
        card.className = 'workout-card';
        
        const isCompleted = state.workoutHistory.some(h => 
            h.programId === program.id && 
            h.workoutIndex === index && 
            h.week === state.currentWeek
        );
        
        if (isCompleted) card.classList.add('completed');
        
        const setTotal = workout.exercises.reduce((acc, ex) => acc + parseInt(ex.sets || 0), 0);

        card.innerHTML = `
            <div class="workout-card-header">
                <h3>${escapeHtml(workout.name)}</h3>
                ${isCompleted ? '<span style="color:var(--success); font-weight:bold; font-size:12px;">✓ COMPLETE</span>' : ''}
            </div>
            <div class="workout-card-meta">
                ${workout.exercises.length} exercises • ${setTotal} sets
            </div>
        `;
        
        card.addEventListener('click', () => startProgramWorkout(index));
        workoutListEl.appendChild(card);
    });
}

function startProgramWorkout(index) {
    if (state.activeWorkout && !confirm("You have a workout in progress. Start a new one and discard the current one?")) {
        return;
    }

    const program = state.programs.find(p => p.id === state.currentProgram);
    const template = program.workouts[index];
    
    const sessionExercises = template.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        sets: Array(parseInt(ex.sets)).fill().map(() => ({ weight: '', reps: ex.reps || 10, completed: false }))
    }));

    state.activeWorkout = {
        type: 'program',
        programId: program.id,
        workoutIndex: index,
        week: state.currentWeek,
        name: template.name,
        startTime: Date.now(),
        isPaused: false,
        totalPausedTime: 0,
        lastPauseTime: null,
        exercises: sessionExercises,
        notes: ''
    };
    
    saveState();
    openActiveWorkout();
}

function startQuickWorkout() {
    if (state.activeWorkout && !confirm("You have a workout in progress. Start a new one and discard the current one?")) {
        return;
    }

    state.activeWorkout = {
        type: 'freestyle',
        name: 'Quick Workout',
        startTime: Date.now(),
        isPaused: false,
        totalPausedTime: 0,
        lastPauseTime: null,
        exercises: [],
        notes: ''
    };
    saveState();
    openActiveWorkout();
}

// --- Active Workout / Logging Logic ---
function openActiveWorkout(isRecovery = false) {
    const modal = document.getElementById('activeWorkoutModal');
    document.getElementById('activeWorkoutTitle').textContent = escapeHtml(state.activeWorkout.name);
    document.getElementById('workoutNotes').value = state.activeWorkout.notes || '';
    
    // Auto-resume
    if (state.activeWorkout.isPaused) {
        state.activeWorkout.isPaused = false;
        if (state.activeWorkout.lastPauseTime) {
            const pauseDuration = Date.now() - state.activeWorkout.lastPauseTime;
            state.activeWorkout.totalPausedTime = (state.activeWorkout.totalPausedTime || 0) + pauseDuration;
        }
        state.activeWorkout.lastPauseTime = null;
        saveState();
    }

    renderActiveExercises();
    modal.classList.add('active');
    
    if(state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(updateWorkoutTimer, 1000);
    
    renderTrainingTab();
}

function updateWorkoutTimer() {
    if (!state.activeWorkout || state.activeWorkout.isPaused) return;
}

function closeActiveWorkout() {
    if (state.activeWorkout && !state.activeWorkout.isPaused) {
        state.activeWorkout.isPaused = true;
        state.activeWorkout.lastPauseTime = Date.now();
        saveState();
    }

    document.getElementById('activeWorkoutModal').classList.remove('active');
    stopRestTimer();
    renderTrainingTab();
}

// HELPER: Get last performance
function getLastExercisePerformance(exerciseId) {
    // Filter history for this exercise
    const matches = [];
    state.workoutHistory.forEach(workout => {
        const ex = workout.exercises.find(e => e.exerciseId === exerciseId);
        if(ex) {
            matches.push({ date: workout.date, sets: ex.sets });
        }
    });
    
    if(matches.length === 0) return null;
    
    // Sort by date desc
    matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const last = matches[0];
    
    // Find best set in that workout (highest weight)
    const bestSet = last.sets.reduce((max, curr) => Number(curr.weight) > Number(max.weight) ? curr : max, last.sets[0]);
    
    return { weight: bestSet.weight, reps: bestSet.reps };
}

function renderActiveExercises() {
    const list = document.getElementById('activeExercisesList');
    list.innerHTML = '';
    
    if (state.activeWorkout.exercises.length === 0) {
        list.innerHTML = '<div class="empty-state">No exercises added yet.<br>Tap "+ Add Exercise" to begin.</div>';
        return;
    }

    state.activeWorkout.exercises.forEach((exercise, exIndex) => {
        const exerciseData = state.exercises.find(e => e.id === exercise.exerciseId);
        const card = document.createElement('div');
        card.className = 'workout-card'; // Use polished card style
        
        const exName = exerciseData ? escapeHtml(exerciseData.name) : 'Unknown Exercise';
        
        // Get Last Performance
        const lastPerf = getLastExercisePerformance(exercise.exerciseId);
        const lastPerfHTML = lastPerf ? 
            `<span style="font-size:13px; color:var(--primary); font-weight:600; background:var(--primary-glow); padding:2px 6px; border-radius:4px;">Last: ${lastPerf.weight} x ${lastPerf.reps}</span>` : 
            `<span style="font-size:12px; color:var(--text-secondary);">New Exercise</span>`;

        let setsHTML = `
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 style="margin-bottom:4px; font-size:18px;">${exName}</h3>
                    ${lastPerfHTML}
                </div>
                <button class="btn-icon-sm" onclick="removeActiveExercise(${exIndex})" style="color:var(--danger); border-color:rgba(239,68,68,0.2);">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="set-row" style="margin-bottom:8px;">
                <span class="set-header text-center">Set</span>
                <span class="set-header text-center">Lbs</span>
                <span class="set-header text-center">Reps</span>
                <span class="set-header text-center">Done</span>
            </div>
        `;
        
        exercise.sets.forEach((set, setIndex) => {
            setsHTML += `
                <div class="set-row">
                    <span class="text-center text-secondary font-bold" style="font-size:14px;">${setIndex + 1}</span>
                    <input type="text" inputmode="decimal" pattern="[0-9]*" value="${set.weight}" placeholder="-" 
                        oninput="updateActiveSet(${exIndex}, ${setIndex}, 'weight', this.value)">
                    <input type="text" inputmode="decimal" pattern="[0-9]*" value="${set.reps}" placeholder="0" 
                        oninput="updateActiveSet(${exIndex}, ${setIndex}, 'reps', this.value)">
                    <button class="set-btn ${set.completed ? 'completed' : ''}" 
                        onclick="toggleSetComplete(${exIndex}, ${setIndex})">
                        ${set.completed ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
                    </button>
                </div>
            `;
        });

        card.innerHTML = `
            ${setsHTML}
            <button class="btn-dashed mt-3" style="border-radius:8px; padding:10px;" onclick="addSetToActive(${exIndex})">+ Add Set</button>
        `;
        list.appendChild(card);
    });
}

window.updateActiveSet = function(exIndex, setIndex, field, value) {
    state.activeWorkout.exercises[exIndex].sets[setIndex][field] = value;
    debouncedSaveState();
};

window.toggleSetComplete = function(exIndex, setIndex) {
    const set = state.activeWorkout.exercises[exIndex].sets[setIndex];
    set.completed = !set.completed;
    renderActiveExercises();
    saveState();
};

window.addSetToActive = function(exIndex) {
    const previousSet = state.activeWorkout.exercises[exIndex].sets[state.activeWorkout.exercises[exIndex].sets.length - 1];
    state.activeWorkout.exercises[exIndex].sets.push({
        weight: previousSet ? previousSet.weight : '',
        reps: previousSet ? previousSet.reps : 10,
        completed: false
    });
    renderActiveExercises();
    saveState();
};

window.removeActiveExercise = function(exIndex) {
    if(confirm('Remove this exercise?')) {
        state.activeWorkout.exercises.splice(exIndex, 1);
        renderActiveExercises();
        saveState();
    }
};

function discardWorkout() {
    if(confirm("Are you sure you want to cancel this workout? All progress will be discarded.")) {
        state.activeWorkout = null;
        saveState();
        document.getElementById('activeWorkoutModal').classList.remove('active');
        stopRestTimer();
        renderTrainingTab();
    }
}

function finishWorkout() {
    const completedExercises = state.activeWorkout.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        sets: ex.sets.filter(s => s.completed || (s.weight && s.reps))
    })).filter(ex => ex.sets.length > 0);

    if (completedExercises.length === 0) {
        alert("You haven't logged any sets!");
        return;
    }

    let endTime = Date.now();
    if (state.activeWorkout.isPaused && state.activeWorkout.lastPauseTime) {
        state.activeWorkout.totalPausedTime += (endTime - state.activeWorkout.lastPauseTime);
    }

    const totalElapsed = endTime - state.activeWorkout.startTime;
    const actualDuration = Math.max(0, totalElapsed - (state.activeWorkout.totalPausedTime || 0));

    const record = {
        id: Date.now(),
        date: new Date().toISOString(),
        programId: state.activeWorkout.programId || null,
        workoutIndex: state.activeWorkout.workoutIndex,
        week: state.activeWorkout.week,
        name: state.activeWorkout.name,
        exercises: completedExercises,
        durationSeconds: Math.floor(actualDuration / 1000),
        notes: state.activeWorkout.notes || ''
    };

    state.workoutHistory.push(record);
    
    state.activeWorkout = null;
    saveState();
    
    document.getElementById('activeWorkoutModal').classList.remove('active');
    stopRestTimer();
    
    renderHistory();
    renderTrainingTab();
}

window.calculateORM = function() {
    const w = parseFloat(document.getElementById('ormWeight').value);
    const r = parseFloat(document.getElementById('ormReps').value);
    
    if(!w || !r) return;
    
    // Epley Formula
    const max = Math.round(w * (1 + r / 30));
    document.getElementById('ormResult').textContent = max;
}

function startRestTimer() {
    state.restTime = 90; 
    document.getElementById('timerOverlay').classList.remove('hidden');
    updateTimerDisplay();
    
    if(state.restTimerInterval) clearInterval(state.restTimerInterval);
    state.restTimerInterval = setInterval(() => {
        state.restTime--;
        updateTimerDisplay();
        if(state.restTime <= 0) {
            stopRestTimer();
        }
    }, 1000);
}

function stopRestTimer() {
    clearInterval(state.restTimerInterval);
    document.getElementById('timerOverlay').classList.add('hidden');
}

function updateTimerDisplay() {
    document.getElementById('timerDisplay').textContent = formatTime(state.restTime);
}

// --- Program Builder Logic ---
function openProgramBuilder(programToEdit = null) {
    const modal = document.getElementById('programBuilderModal');
    const title = document.getElementById('modalTitle');
    
    if (programToEdit) {
        title.textContent = 'Edit Program';
        state.editingProgram = deepClone(programToEdit);
    } else {
        title.textContent = 'Create Program';
        state.editingProgram = { 
            id: null,
            name: '',
            weeks: 4,
            workouts: [] 
        };
    }
    
    document.getElementById('programNameInput').value = state.editingProgram.name;
    document.getElementById('programWeeksInput').value = state.editingProgram.weeks;
    renderProgramBuilderWorkouts();
    
    modal.classList.add('active');
}

// Fleshed Out: Collapsible Workout Cards in Program Builder
function renderProgramBuilderWorkouts() {
    const builder = document.getElementById('workoutBuilder');
    builder.innerHTML = '';
    
    if(state.editingProgram.workouts.length === 0) {
        builder.innerHTML = '<div class="empty-state">No workouts added yet.</div>';
        return;
    }

    state.editingProgram.workouts.forEach((workout, i) => {
        // Collapsible Card
        const details = document.createElement('details');
        details.className = 'category-group'; // Reuse this style for consistent feel
        details.open = true;

        const summary = document.createElement('summary');
        summary.innerHTML = `
            <div class="flex flex-grow justify-between items-center" style="width:100%">
                <span class="font-bold">${escapeHtml(workout.name)}</span>
                <span class="text-secondary text-sm">${workout.exercises.length} Exercises</span>
            </div>
        `;
        
        const content = document.createElement('div');
        content.className = 'category-content';
        
        // Mini list of exercises inside the card
        if (workout.exercises.length > 0) {
            workout.exercises.forEach(ex => {
                const exData = state.exercises.find(e => e.id === ex.exerciseId);
                const row = document.createElement('div');
                row.className = 'flex justify-between text-sm py-2 border-bottom';
                row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                row.innerHTML = `
                    <span class="text-secondary">${exData ? escapeHtml(exData.name) : 'Unknown'}</span>
                    <span>${ex.sets} sets × ${ex.reps}</span>
                `;
                content.appendChild(row);
            });
        } else {
            content.innerHTML = '<div class="text-center text-sm text-secondary py-2">No exercises added.</div>';
        }

        // Controls Footer inside the card
        const controls = document.createElement('div');
        controls.className = 'builder-controls';
        controls.innerHTML = `
            <button class="btn-secondary" style="width:auto; padding:6px 12px; font-size:12px;" onclick="editBuilderWorkout(${i})">Edit</button>
            <button class="btn-secondary" style="width:auto; padding:6px 12px; font-size:12px;" onclick="moveWorkout(${i}, -1)" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn-secondary" style="width:auto; padding:6px 12px; font-size:12px;" onclick="moveWorkout(${i}, 1)" ${i === state.editingProgram.workouts.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn-text-danger" style="width:auto;" onclick="removeWorkoutFromProgram(${i})">Delete</button>
        `;
        
        content.appendChild(controls);
        details.appendChild(summary);
        details.appendChild(content);
        
        builder.appendChild(details);
    });
}

function closeProgramBuilder() {
    document.getElementById('programBuilderModal').classList.remove('active');
    state.editingProgram = null;
}

function addWorkoutToProgram() {
    openWorkoutBuilder();
}

window.editBuilderWorkout = function(index) {
    const workout = state.editingProgram.workouts[index];
    openWorkoutBuilder(workout, index);
};

window.removeWorkoutFromProgram = function(index) {
    state.editingProgram.workouts.splice(index, 1);
    renderProgramBuilderWorkouts();
};

window.moveWorkout = function(index, direction) {
    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < state.editingProgram.workouts.length) {
        const temp = state.editingProgram.workouts[index];
        state.editingProgram.workouts[index] = state.editingProgram.workouts[newIndex];
        state.editingProgram.workouts[newIndex] = temp;
        renderProgramBuilderWorkouts();
    }
};

function saveProgram() {
    const name = document.getElementById('programNameInput').value.trim();
    const weeks = parseInt(document.getElementById('programWeeksInput').value);
    
    if (!name) {
        alert('Please enter a program name');
        return;
    }
    
    state.editingProgram.name = name;
    state.editingProgram.weeks = weeks;
    
    if (state.editingProgram.id) {
        const index = state.programs.findIndex(p => p.id === state.editingProgram.id);
        state.programs[index] = state.editingProgram;
    } else {
        state.editingProgram.id = Date.now();
        state.programs.push(state.editingProgram);
    }
    
    saveState();
    closeProgramBuilder();
    renderProgramsList();
}


// --- Workout Builder Logic ---
function openWorkoutBuilder(workoutToEdit = null, workoutIndex = null) {
    const modal = document.getElementById('workoutBuilderModal');
    
    if (workoutToEdit) {
        state.editingWorkout = deepClone(workoutToEdit);
        state.editingWorkout.index = workoutIndex; 
    } else {
        state.editingWorkout = { name: '', exercises: [] };
    }
    
    document.getElementById('workoutNameInput').value = state.editingWorkout.name;
    renderWorkoutBuilderExercises();
    
    modal.classList.add('active');
}

function renderWorkoutBuilderExercises() {
    const builder = document.getElementById('exerciseBuilder');
    builder.innerHTML = '';
    
    state.editingWorkout.exercises.forEach((ex, i) => {
        const exerciseData = state.exercises.find(e => e.id === ex.exerciseId);
        const item = document.createElement('div');
        item.className = 'builder-item';
        item.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <strong>${exerciseData ? escapeHtml(exerciseData.name) : 'Unknown'}</strong>
                <div class="flex gap-2">
                    <button class="btn-icon-sm" style="width:28px; height:28px;" onclick="moveExercise(${i}, -1)">↑</button>
                    <button class="btn-icon-sm" style="width:28px; height:28px;" onclick="moveExercise(${i}, 1)">↓</button>
                    <button class="btn-text-danger" onclick="removeExerciseFromBuilder(${i})">✕</button>
                </div>
            </div>
            <div class="flex gap-2">
                <input type="text" inputmode="decimal" pattern="[0-9]*" class="input-field" style="margin:0; padding:8px;" value="${ex.sets}" placeholder="Sets" onchange="updateBuilderExercise(${i}, 'sets', this.value)">
                <input type="text" inputmode="decimal" pattern="[0-9]*" class="input-field" style="margin:0; padding:8px;" value="${ex.reps}" placeholder="Reps" onchange="updateBuilderExercise(${i}, 'reps', this.value)">
            </div>
        `;
        builder.appendChild(item);
    });
}

window.updateBuilderExercise = function(index, field, value) {
    state.editingWorkout.exercises[index][field] = value;
};

window.removeExerciseFromBuilder = function(index) {
    state.editingWorkout.exercises.splice(index, 1);
    renderWorkoutBuilderExercises();
};

window.moveExercise = function(index, direction) {
    const newIndex = index + direction;
    if (newIndex >= 0 && newIndex < state.editingWorkout.exercises.length) {
        const temp = state.editingWorkout.exercises[index];
        state.editingWorkout.exercises[index] = state.editingWorkout.exercises[newIndex];
        state.editingWorkout.exercises[newIndex] = temp;
        renderWorkoutBuilderExercises();
    }
};

function closeWorkoutBuilder() {
    document.getElementById('workoutBuilderModal').classList.remove('active');
    state.editingWorkout = null;
}

function saveWorkout() {
    const name = document.getElementById('workoutNameInput').value.trim();
    if(!name) return alert("Workout name required");
    
    state.editingWorkout.name = name;
    
    if (state.editingWorkout.index !== undefined && state.editingWorkout.index !== null) {
        state.editingProgram.workouts[state.editingWorkout.index] = state.editingWorkout;
    } else {
        state.editingProgram.workouts.push(state.editingWorkout);
    }
    
    renderProgramBuilderWorkouts();
    closeWorkoutBuilder();
}


// --- Exercise Selection Logic ---
function openExerciseSelection(source) {
    state.exerciseSelectionSource = source;
    renderExerciseSelection();
    document.getElementById('exerciseSelectionModal').classList.add('active');
}

function closeExerciseSelection() {
    document.getElementById('exerciseSelectionModal').classList.remove('active');
    state.exerciseSelectionSource = null;
}

function renderExerciseSelection(filter = '') {
    const list = document.getElementById('exerciseSelectionList');
    list.innerHTML = '';
    
    const filtered = state.exercises.filter(e => 
        e.name.toLowerCase().includes(filter.toLowerCase())
    );
    
    // Group exercises by category for selection list too
    const categories = {};
    filtered.forEach(ex => {
        const rawCat = ex.category || 'Other';
        const cat = rawCat.charAt(0).toUpperCase() + rawCat.slice(1).toLowerCase();
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(ex);
    });

    const sortedCategories = Object.keys(categories).sort();

    sortedCategories.forEach(cat => {
        const exercises = categories[cat];
        
        const catHeader = document.createElement('div');
        catHeader.className = 'section-title';
        catHeader.style.margin = '16px 0 8px 0';
        catHeader.style.fontSize = '14px';
        catHeader.style.color = 'var(--primary)';
        catHeader.textContent = cat.toUpperCase();
        list.appendChild(catHeader);
        
        exercises.forEach(exercise => {
            const item = document.createElement('div');
            item.className = 'builder-item';
            item.style.cursor = 'pointer';
            item.innerHTML = `
                <h4 style="font-size:16px;">${escapeHtml(exercise.name)}</h4>
            `;
            item.addEventListener('click', () => selectExercise(exercise));
            list.appendChild(item);
        });
    });
}

function filterExerciseSelection(e) {
    renderExerciseSelection(e.target.value);
}

function selectExercise(exercise) {
    if (state.exerciseSelectionSource === 'workoutBuilder') {
        state.editingWorkout.exercises.push({
            exerciseId: exercise.id,
            sets: 3,
            reps: 10
        });
        renderWorkoutBuilderExercises();
    } else if (state.exerciseSelectionSource === 'activeWorkout') {
        state.activeWorkout.exercises.push({
            exerciseId: exercise.id,
            sets: [{weight: '', reps: 10, completed: false}]
        });
        saveState(); // Auto-save
        renderActiveExercises();
    }
    closeExerciseSelection();
}

// --- Library & Generic Logic ---
function renderProgramsList() {
    const list = document.getElementById('programsList');
    list.innerHTML = '';
    
    if (state.programs.length === 0) {
        list.innerHTML = '<div class="empty-state">No programs created yet.</div>';
        return;
    }
    
    state.programs.forEach(program => {
        const card = document.createElement('div');
        card.className = 'card';
        const isActive = state.currentProgram === program.id;
        
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div>
                    <h3 style="margin-bottom:4px;">${escapeHtml(program.name)}</h3>
                    <p class="text-secondary text-sm mb-2">${program.weeks} weeks • ${program.workouts.length} workouts</p>
                </div>
                ${isActive ? '<span style="background:var(--primary-glow); color:var(--primary); padding:2px 8px; border-radius:100px; font-size:11px; font-weight:bold; border:1px solid var(--primary);">ACTIVE</span>' : ''}
            </div>
            <div class="flex gap-2 mt-3">
                <button class="btn-secondary" style="width:auto; font-size:13px; padding:8px 16px;" onclick="selectProgram(${program.id})" ${isActive ? 'disabled' : ''}>
                    ${isActive ? 'Selected' : 'Select'}
                </button>
                <button class="btn-secondary" style="width:auto; font-size:13px; padding:8px 16px;" onclick="editProgram(${program.id})">Edit</button>
                <button class="btn-text-danger" style="width:auto;" onclick="deleteProgram(${program.id})">Delete</button>
            </div>
        `;
        list.appendChild(card);
    });
}

window.selectProgram = function(id) {
    state.currentProgram = id;
    state.currentWeek = 1;
    saveState();
    renderTrainingTab();
    renderProgramsList();
    document.querySelector('.tab-btn[data-tab="training"]').click();
};

window.editProgram = function(id) {
    const program = state.programs.find(p => p.id === id);
    if (program) openProgramBuilder(program);
};

window.deleteProgram = function(id) {
    if (confirm('Delete this program?')) {
        state.programs = state.programs.filter(p => p.id !== id);
        if (state.currentProgram === id) state.currentProgram = null;
        saveState();
        renderProgramsList();
        renderTrainingTab();
    }
};

// Updated: Exercises List with Collapsible Muscle Categories
function renderExercisesList(filter = '') {
    const list = document.getElementById('exercisesList');
    list.innerHTML = '';
    
    const filtered = state.exercises.filter(e => 
        e.name.toLowerCase().includes(filter.toLowerCase())
    );
    
    // Group by Category
    const categories = {};
    filtered.forEach(ex => {
        const rawCat = ex.category || 'Other';
        const cat = rawCat.charAt(0).toUpperCase() + rawCat.slice(1).toLowerCase();
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(ex);
    });

    const sortedCategories = Object.keys(categories).sort();

    if (sortedCategories.length === 0) {
        list.innerHTML = '<div class="empty-state">No exercises found.</div>';
        return;
    }

    sortedCategories.forEach(cat => {
        const exercises = categories[cat];
        
        // Create collapsible details element
        const details = document.createElement('details');
        details.className = 'category-group';
        details.open = true; // Default open
        
        const summary = document.createElement('summary');
        summary.innerHTML = `
            <span class="font-bold text-primary">${cat}</span>
            <span class="text-secondary text-sm" style="margin-left:auto;">${exercises.length}</span>
        `;
        details.appendChild(summary);
        
        const content = document.createElement('div');
        content.className = 'category-content';
        
        exercises.forEach(exercise => {
            const card = document.createElement('div');
            card.className = 'exercise-item-row'; 
            card.innerHTML = `
                <div>
                    <h4>${escapeHtml(exercise.name)}</h4>
                </div>
                <button class="btn-icon-sm" onclick="deleteExercise(${exercise.id})" style="color:var(--danger); border:none; background:transparent;">
                     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;
            content.appendChild(card);
        });
        
        details.appendChild(content);
        list.appendChild(details);
    });
}

function filterExercises(e) {
    renderExercisesList(e.target.value);
}

window.deleteExercise = function(id) {
    if (confirm('Delete this exercise?')) {
        state.exercises = state.exercises.filter(e => e.id !== id);
        saveState();
        renderExercisesList();
    }
};

function openAddExercise() {
    document.getElementById('addExerciseModal').classList.add('active');
    const input = document.getElementById('exerciseNameInput');
    input.value = '';
    input.focus(); 
}

function closeAddExercise() {
    document.getElementById('addExerciseModal').classList.remove('active');
}

function saveExercise() {
    const name = document.getElementById('exerciseNameInput').value.trim();
    const category = document.getElementById('exerciseCategoryInput').value;
    
    if (!name) { alert('Name required'); return; }
    
    state.exercises.push({ id: Date.now(), name, category });
    saveState();
    closeAddExercise();
    renderExercisesList();
}