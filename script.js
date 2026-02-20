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

// Strictly enforce numeric inputs on text fields, preventing letters and duplicate decimals
window.enforceNumeric = function(input, isDecimal) {
    if (isDecimal) {
        input.value = input.value.replace(/[^0-9.]/g, '');
        const parts = input.value.split('.');
        if (parts.length > 2) {
            input.value = parts[0] + '.' + parts.slice(1).join('');
        }
    } else {
        input.value = input.value.replace(/[^0-9]/g, '');
    }
};

// Enforce Rep Range for Templates (allows numbers and a single dash)
window.enforceRepRange = function(input) {
    input.value = input.value.replace(/[^0-9-]/g, '');
    const parts = input.value.split('-');
    if (parts.length > 2) {
        input.value = parts[0] + '-' + parts.slice(1).join('');
    }
};

// --- State Management ---
let state = {
    exercises: [],
    programs: [],
    standaloneWorkouts: [],
    currentProgram: null,
    currentWeek: 1,
    workoutHistory: [],
    bodyweightHistory: [],
    activeWorkout: null,
    editingProgram: null,
    editingWorkout: null,
    workoutBuilderContext: 'program',
    weightUnit: 'lbs'
};

// --- Workout Duration Timer ---
let workoutDurationInterval = null;
let workoutStartTime = null;

function startWorkoutTimer() {
    workoutStartTime = state.activeWorkout.startTime || Date.now();
    if (!state.activeWorkout.startTime) {
        state.activeWorkout.startTime = workoutStartTime;
    }
    clearInterval(workoutDurationInterval);
    workoutDurationInterval = setInterval(updateWorkoutDurationDisplay, 1000);
    updateWorkoutDurationDisplay();
    const badge = document.getElementById('workoutDurationDisplay');
    if (badge) badge.classList.add('active');
}

function stopWorkoutTimer() {
    clearInterval(workoutDurationInterval);
    workoutDurationInterval = null;
    const badge = document.getElementById('workoutDurationDisplay');
    if (badge) badge.classList.remove('active');
}

function updateWorkoutDurationDisplay() {
    const el = document.getElementById('workoutDurationText');
    if (!el || !workoutStartTime) return;
    const elapsed = Math.floor((Date.now() - workoutStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// --- Rest Timer ---
let restTimerInterval = null;
let restTimerRemaining = 0;
let restTimerTotal = 0;

function getRestTimeForExercise(exerciseId) {
    const ex = state.exercises.find(e => e.id === exerciseId);
    return (ex && ex.restTime) ? parseInt(ex.restTime) : 90;
}

function startRestTimer(duration, exerciseName) {
    restTimerTotal = duration;
    restTimerRemaining = duration;
    showRestTimer(exerciseName);
    restTimerInterval = setInterval(runRestTimerTick, 1000);
}

function runRestTimerTick() {
    restTimerRemaining--;
    updateRestTimerDisplay();
    if (restTimerRemaining <= 0) {
        skipRestTimer(true);
        playRestDoneBeep();
    }
}

function updateRestTimerDisplay() {
    const countdown = document.getElementById('restTimerCountdown');
    const ring = document.getElementById('restTimerRingProgress');
    if (!countdown || !ring) return;

    countdown.textContent = restTimerRemaining;

    const circumference = 326.726;
    const progress = restTimerRemaining / restTimerTotal;
    ring.style.strokeDashoffset = circumference * (1 - progress);

    ring.classList.remove('warning', 'urgent');
    if (restTimerRemaining <= 10) ring.classList.add('urgent');
    else if (restTimerRemaining <= 20) ring.classList.add('warning');
}

function showRestTimer(exerciseName) {
    const overlay = document.getElementById('restTimerOverlay');
    const nameEl = document.getElementById('restTimerExerciseName');
    if (overlay) overlay.classList.add('active');
    if (nameEl) nameEl.textContent = exerciseName ? `After: ${exerciseName}` : '';
    updateRestTimerDisplay();
}

window.skipRestTimer = function() {
    clearInterval(restTimerInterval);
    restTimerInterval = null;
    const overlay = document.getElementById('restTimerOverlay');
    if (overlay) overlay.classList.remove('active');
};

window.adjustRestTimer = function(delta) {
    restTimerRemaining = Math.max(1, restTimerRemaining + delta);
    restTimerTotal = Math.max(restTimerTotal, restTimerRemaining);
    updateRestTimerDisplay();
};

function playRestDoneBeep() {
    try {
        const ctx = new(window.AudioContext || window.webkitAudioContext)();
        [0, 0.15, 0.30].forEach(offset => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.2);
            osc.start(ctx.currentTime + offset);
            osc.stop(ctx.currentTime + offset + 0.2);
        });
    } catch (e) {}
}

// --- Weight Unit ---
window.setWeightUnit = function(unit) {
    state.weightUnit = unit;
    saveState();
    const lbsBtn = document.getElementById('unitLbs');
    const kgBtn = document.getElementById('unitKg');
    if (lbsBtn) lbsBtn.classList.toggle('active', unit === 'lbs');
    if (kgBtn) kgBtn.classList.toggle('active', unit === 'kg');
    renderActiveExercises();
};

function getWeightUnitLabel() {
    return state.weightUnit || 'lbs';
}

// Initialize with Async DB
async function initializeApp() {
    try {
        const savedState = await db.load();

        if (savedState) {
            state = {
                ...state,
                ...savedState
            };
        }
        
        // Ensure clean, alphabetically sorted exercise database
        if (!state.exercises || state.exercises.length < 50 || state.exercises.some(e => e.name === '')) {
            state.exercises = [
                {id: 75, name: 'Ab Wheel Rollout', category: 'Abs', restTime: 60},
                {id: 26, name: 'Arnold Press', category: 'Anterior Deltoid', restTime: 90},
                {id: 1, name: 'Barbell Bench Press', category: 'Chest', restTime: 120},
                {id: 34, name: 'Barbell Curl', category: 'Biceps', restTime: 90},
                {id: 64, name: 'Barbell Hip Thrust', category: 'Glutes', restTime: 120},
                {id: 14, name: 'Barbell Row', category: 'Lats', restTime: 120},
                {id: 21, name: 'Barbell Shrug', category: 'Traps', restTime: 60},
                {id: 79, name: 'Barbell Side Bend', category: 'Abs', restTime: 60},
                {id: 51, name: 'Barbell Squat', category: 'Quadriceps', restTime: 180},
                {id: 55, name: 'Bulgarian Split Squat', category: 'Quadriceps', restTime: 90},
                {id: 74, name: 'Cable Crunch', category: 'Abs', restTime: 60},
                {id: 7, name: 'Cable Crossover', category: 'Chest', restTime: 60},
                {id: 37, name: 'Cable Curl', category: 'Biceps', restTime: 60},
                {id: 81, name: 'Cable Hip Abduction', category: 'Other', restTime: 60},
                {id: 83, name: 'Cable Hip Adduction', category: 'Other', restTime: 60},
                {id: 29, name: 'Cable Lateral Raise', category: 'Lateral Deltoid', restTime: 60},
                {id: 66, name: 'Cable Pull Through', category: 'Glutes', restTime: 60},
                {id: 12, name: 'Chin-Up', category: 'Lats', restTime: 120},
                {id: 45, name: 'Close Grip Bench Press', category: 'Triceps', restTime: 120},
                {id: 41, name: 'Concentration Curl', category: 'Biceps', restTime: 60},
                {id: 71, name: 'Crunch', category: 'Abs', restTime: 60},
                {id: 19, name: 'Deadlift', category: 'Lats', restTime: 180},
                {id: 5, name: 'Decline Barbell Bench Press', category: 'Chest', restTime: 90},
                {id: 77, name: 'Decline Crunch', category: 'Abs', restTime: 60},
                {id: 2, name: 'Dumbbell Bench Press', category: 'Chest', restTime: 120},
                {id: 35, name: 'Dumbbell Curl', category: 'Biceps', restTime: 60},
                {id: 9, name: 'Dumbbell Fly', category: 'Chest', restTime: 60},
                {id: 47, name: 'Dumbbell Kickback', category: 'Triceps', restTime: 60},
                {id: 15, name: 'Dumbbell Row', category: 'Lats', restTime: 90},
                {id: 25, name: 'Dumbbell Shoulder Press', category: 'Anterior Deltoid', restTime: 90},
                {id: 22, name: 'Dumbbell Shrug', category: 'Traps', restTime: 60},
                {id: 38, name: 'EZ Bar Curl', category: 'Biceps', restTime: 90},
                {id: 32, name: 'Face Pull', category: 'Posterior Deltoid', restTime: 60},
                {id: 23, name: 'Farmer\'s Walk', category: 'Traps', restTime: 90},
                {id: 27, name: 'Front Raise', category: 'Anterior Deltoid', restTime: 60},
                {id: 54, name: 'Front Squat', category: 'Quadriceps', restTime: 120},
                {id: 65, name: 'Glute Kickback', category: 'Glutes', restTime: 60},
                {id: 58, name: 'Goblet Squat', category: 'Quadriceps', restTime: 90},
                {id: 62, name: 'Good Mornings', category: 'Hamstrings', restTime: 120},
                {id: 56, name: 'Hack Squat', category: 'Quadriceps', restTime: 120},
                {id: 36, name: 'Hammer Curl', category: 'Biceps', restTime: 60},
                {id: 78, name: 'Hanging Knee Raise', category: 'Abs', restTime: 60},
                {id: 73, name: 'Hanging Leg Raise', category: 'Abs', restTime: 60},
                {id: 80, name: 'Hip Abduction Machine', category: 'Other', restTime: 60},
                {id: 82, name: 'Hip Adduction Machine', category: 'Other', restTime: 60},
                {id: 3, name: 'Incline Barbell Bench Press', category: 'Chest', restTime: 120},
                {id: 4, name: 'Incline Dumbbell Bench Press', category: 'Chest', restTime: 120},
                {id: 39, name: 'Incline Dumbbell Curl', category: 'Biceps', restTime: 60},
                {id: 67, name: 'Kettlebell Swing', category: 'Glutes', restTime: 90},
                {id: 13, name: 'Lat Pulldown', category: 'Lats', restTime: 90},
                {id: 28, name: 'Lateral Raise', category: 'Lateral Deltoid', restTime: 60},
                {id: 53, name: 'Leg Extension', category: 'Quadriceps', restTime: 90},
                {id: 52, name: 'Leg Press', category: 'Quadriceps', restTime: 120},
                {id: 70, name: 'Leg Press Calf Raise', category: 'Calves', restTime: 60},
                {id: 60, name: 'Lying Leg Curl', category: 'Hamstrings', restTime: 90},
                {id: 10, name: 'Machine Chest Press', category: 'Chest', restTime: 90},
                {id: 30, name: 'Machine Lateral Raise', category: 'Lateral Deltoid', restTime: 60},
                {id: 20, name: 'Machine Row', category: 'Lats', restTime: 90},
                {id: 24, name: 'Overhead Press', category: 'Anterior Deltoid', restTime: 120},
                {id: 43, name: 'Overhead Tricep Extension', category: 'Triceps', restTime: 60},
                {id: 8, name: 'Pec Deck Fly', category: 'Chest', restTime: 60},
                {id: 72, name: 'Plank', category: 'Abs', restTime: 60},
                {id: 40, name: 'Preacher Curl', category: 'Biceps', restTime: 60},
                {id: 11, name: 'Pull-Up', category: 'Lats', restTime: 120},
                {id: 6, name: 'Push-Ups', category: 'Chest', restTime: 60},
                {id: 50, name: 'Reverse Barbell Curl', category: 'Forearms', restTime: 60},
                {id: 33, name: 'Reverse Dumbbell Fly', category: 'Posterior Deltoid', restTime: 60},
                {id: 31, name: 'Reverse Pec Deck', category: 'Posterior Deltoid', restTime: 60},
                {id: 49, name: 'Reverse Wrist Curl', category: 'Forearms', restTime: 60},
                {id: 59, name: 'Romanian Deadlift', category: 'Hamstrings', restTime: 120},
                {id: 76, name: 'Russian Twist', category: 'Abs', restTime: 60},
                {id: 16, name: 'Seated Cable Row', category: 'Lats', restTime: 90},
                {id: 68, name: 'Seated Calf Raise', category: 'Calves', restTime: 60},
                {id: 61, name: 'Seated Leg Curl', category: 'Hamstrings', restTime: 90},
                {id: 44, name: 'Skullcrusher', category: 'Triceps', restTime: 90},
                {id: 69, name: 'Standing Calf Raise', category: 'Calves', restTime: 60},
                {id: 63, name: 'Stiff-Legged Deadlift', category: 'Hamstrings', restTime: 120},
                {id: 18, name: 'Straight Arm Pulldown', category: 'Lats', restTime: 60},
                {id: 17, name: 'T-Bar Row', category: 'Lats', restTime: 120},
                {id: 46, name: 'Tricep Dips', category: 'Triceps', restTime: 90},
                {id: 42, name: 'Tricep Pushdown', category: 'Triceps', restTime: 60},
                {id: 57, name: 'Walking Lunges', category: 'Quadriceps', restTime: 90},
                {id: 48, name: 'Wrist Curl', category: 'Forearms', restTime: 60}
            ];
            await db.save(state);
        }

        // Render UI
        initializeTabs();
        initializeLibraryTabs();
        resetLibraryTabs();
        initializeModals();
        renderTrainingTab();
        renderProgramsList();
        renderStandaloneWorkoutsList();
        renderExercisesList();
        renderBodyweight();
        renderSettingsPreferences();
        renderProgressTab();

    } catch (err) {
        console.error("Init failed:", err);
    }
}

async function saveState() {
    const stateToSave = {
        exercises: state.exercises,
        programs: state.programs,
        standaloneWorkouts: state.standaloneWorkouts,
        currentProgram: state.currentProgram,
        currentWeek: state.currentWeek,
        workoutHistory: state.workoutHistory,
        bodyweightHistory: state.bodyweightHistory,
        activeWorkout: state.activeWorkout,
        weightUnit: state.weightUnit
    };
    await db.save(stateToSave);
}

const debouncedSaveState = debounce(saveState, 1000);

window.resetApp = async function() {
    if (confirm("Are you sure you want to wipe all data? This cannot be undone.")) {
        await db.clear();
        location.reload();
    }
}

// --- Import / Export ---
window.exportData = async function() {
    const data = await db.load();
    if (!data) return alert("No data to export.");
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data));
    const downloadNode = document.createElement('a');
    downloadNode.setAttribute("href", dataStr);
    downloadNode.setAttribute("download", `workouts_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadNode);
    downloadNode.click();
    downloadNode.remove();
};

window.importData = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const importedState = JSON.parse(e.target.result);
            if (importedState && importedState.exercises) {
                await db.save(importedState);
                alert("Database imported successfully!");
                location.reload();
            } else {
                alert("Invalid file format.");
            }
        } catch (err) {
            alert("Error parsing file.");
        }
    };
    reader.readAsText(file);
};

// --- Bodyweight Tracker ---
window.logBodyweight = function() {
    const val = document.getElementById('bwInput').value;
    if (!val) return;
    state.bodyweightHistory.push({
        id: Date.now(),
        date: new Date().toISOString(),
        weight: parseFloat(val)
    });
    saveState();
    renderBodyweight();
    document.getElementById('bwInput').value = '';
};

window.deleteBodyweight = function(id) {
    if (confirm("Delete this weight log?")) {
        state.bodyweightHistory = state.bodyweightHistory.filter(b => b.id !== id);
        saveState();
        renderBodyweight();
    }
};

window.editBodyweight = function(id) {
    const entry = state.bodyweightHistory.find(b => b.id === id);
    if (!entry) return;
    const newWeight = prompt("Enter new weight:", entry.weight);
    if (newWeight !== null && !isNaN(parseFloat(newWeight))) {
        entry.weight = parseFloat(newWeight);
        saveState();
        renderBodyweight();
    }
};

function renderBodyweight() {
    const container = document.getElementById('bwHistory');
    if (!container) return;
    if (!state.bodyweightHistory || state.bodyweightHistory.length === 0) {
        container.innerHTML = "No bodyweight logs yet.";
        return;
    }
    const sorted = [...state.bodyweightHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    container.innerHTML = sorted.map(b => `
        <div class="flex justify-between items-center py-2 border-b">
            <span>${new Date(b.date).toLocaleDateString()}</span>
            <div class="flex items-center gap-2">
                <span class="font-bold text-primary mr-2">${b.weight}</span>
                <button class="btn-icon-xs" onclick="editBodyweight(${b.id})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button class="btn-icon-xs btn-transparent-danger" onclick="deleteBodyweight(${b.id})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>
    `).join('');
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

            if (tabName === 'library') {
                resetLibraryTabs();
            }
            if (tabName === 'progress') {
                renderProgressTab();
            }
        });
    });
}

function resetLibraryTabs() {
    const programContent = document.getElementById('programs');
    const workoutContent = document.getElementById('standalone-workouts');
    const exerciseContent = document.getElementById('exercises');

    const programBtn = document.querySelector('[data-library-tab="programs"]');
    const workoutBtn = document.querySelector('[data-library-tab="standalone-workouts"]');
    const exerciseBtn = document.querySelector('[data-library-tab="exercises"]');

    if (programContent && exerciseContent && workoutContent) {
        programContent.classList.add('active');
        programContent.style.display = 'block';

        workoutContent.classList.remove('active');
        workoutContent.style.display = 'none';

        exerciseContent.classList.remove('active');
        exerciseContent.style.display = 'none';
    }

    if (programBtn && exerciseBtn && workoutBtn) {
        programBtn.classList.add('active');
        workoutBtn.classList.remove('active');
        exerciseBtn.classList.remove('active');
    }
}

function initializeLibraryTabs() {
    const libraryTabBtns = document.querySelectorAll('.library-tab-btn');
    const libraryContents = document.querySelectorAll('.library-content');

    libraryTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.libraryTab;

            libraryTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            libraryContents.forEach(content => {
                content.classList.remove('active');
                content.style.display = 'none';
            });

            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.classList.add('active');
                targetEl.style.display = 'block';
            }
        });
    });
}

// --- Modals & Event Listeners ---
function initializeModals() {
    attachListener('createProgramBtn', 'click', () => openProgramBuilder());
    attachListener('closeProgramModal', 'click', closeProgramBuilder);
    attachListener('cancelProgramBtn', 'click', closeProgramBuilder);
    attachListener('saveProgramBtn', 'click', saveProgram);
    attachListener('addWorkoutBtn', 'click', addWorkoutToProgram);

    attachListener('createStandaloneBtn', 'click', () => openWorkoutBuilder(null, null, 'standalone'));

    attachListener('closeWorkoutModal', 'click', closeWorkoutBuilder);
    attachListener('cancelWorkoutBtn', 'click', closeWorkoutBuilder);
    attachListener('saveWorkoutBtn', 'click', saveWorkout);
    attachListener('addExerciseToWorkoutBtn', 'click', () => openExerciseSelection('workoutBuilder'));

    attachListener('closeExerciseSelectionModal', 'click', closeExerciseSelection);
    attachListener('exerciseSelectionSearch', 'input', filterExerciseSelection);

    attachListener('createExerciseBtn', 'click', openAddExercise);
    attachListener('closeAddExerciseModal', 'click', closeAddExercise);
    attachListener('cancelExerciseBtn', 'click', closeAddExercise);
    attachListener('saveExerciseBtn', 'click', saveExercise);

    attachListener('closeActiveWorkoutModal', 'click', closeActiveWorkout);
    attachListener('finishWorkoutBtn', 'click', finishWorkout);
    attachListener('discardWorkoutBtn', 'click', discardWorkout);
    attachListener('addExerciseToActiveBtn', 'click', () => openExerciseSelection('activeWorkout'));

    attachListener('workoutNotes', 'input', (e) => {
        if (state.activeWorkout) {
            state.activeWorkout.notes = e.target.value;
            debouncedSaveState();
        }
    });

    attachListener('openHistoryBtn', 'click', openHistoryModal);
    attachListener('closeHistoryModal', 'click', closeHistoryModal);

    attachListener('selectProgramBtn', 'click', () => {
        const libBtn = document.querySelector('.tab-btn[data-tab="library"]');
        if (libBtn) libBtn.click();
    });
    attachListener('quickLogBtn', 'click', startQuickWorkout);
    attachListener('exerciseSearch', 'input', filterExercises);
}

// --- History Logic ---
function openHistoryModal() {
    document.getElementById('historyModal').classList.add('active');
    renderHistory();
}

function closeHistoryModal() {
    document.getElementById('historyModal').classList.remove('active');
}

window.deleteHistoryWorkout = function(id) {
    if (confirm("Are you sure you want to delete this workout log?")) {
        state.workoutHistory = state.workoutHistory.filter(w => w.id !== id);
        saveState();
        renderHistory();
    }
};

window.editHistoryWorkout = function(id) {
    const record = state.workoutHistory.find(w => w.id === id);
    if (!record) return;

    state.activeWorkout = deepClone(record);
    state.activeWorkout.historyId = id;

    saveState();
    closeHistoryModal();
    openActiveWorkout();
};

function renderHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';

    if (state.workoutHistory.length === 0) {
        list.innerHTML = '<div class="empty-state">No history yet.</div>';
        return;
    }

    const sorted = [...state.workoutHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    const exercisesMap = new Map(state.exercises.map(ex => [ex.id, ex.name]));

    sorted.forEach(record => {
        const date = new Date(record.date).toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
        const notesHTML = record.notes ? `<div class="history-card-notes">"${escapeHtml(record.notes)}"</div>` : '';

        const card = document.createElement('div');
        card.className = 'card';

        let exercisesHTML = '';
        record.exercises.forEach(ex => {
            const exerciseName = exercisesMap.get(ex.exerciseId) || 'Unknown Exercise';
            const bestSet = ex.sets.reduce((max, curr) => Number(curr.weight) > Number(max.weight) ? curr : max, ex.sets[0]);

            exercisesHTML += `
                <div class="history-card-row">
                    <span class="text-secondary">${escapeHtml(exerciseName)}</span>
                    <span>${ex.sets.length} sets • Best: ${bestSet && bestSet.weight ? bestSet.weight : 0}</span>
                </div>
            `;
        });

        card.innerHTML = `
            <div class="flex justify-between items-center mb-2 border-b pb-2">
                <h3 class="text-lg">${escapeHtml(record.name)}</h3>
                <span class="text-secondary text-sm">${date}</span>
            </div>
            <div>
                ${exercisesHTML}
            </div>
            ${notesHTML}
            <div class="flex gap-2 mt-4 pt-2 border-t">
                <button class="btn-secondary btn-sm flex-grow" onclick="editHistoryWorkout(${record.id})">Edit</button>
                <button class="btn-text-danger btn-sm" onclick="deleteHistoryWorkout(${record.id})">Delete</button>
            </div>
        `;
        list.appendChild(card);
    });
}

// --- Training Tab Logic ---
function getLastWorkoutDate(templateName, programId, workoutIndex) {
    // Find most recent history entry matching this workout
    const matches = state.workoutHistory.filter(w => {
        if (programId) return w.programId === programId && w.workoutIndex === workoutIndex;
        return w.name === templateName;
    });
    if (matches.length === 0) return null;
    matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    return new Date(matches[0].date);
}

function formatLastDone(date) {
    if (!date) return null;
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays/7)}w ago`;
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
    });
}

function renderTrainingTab() {
    const container = document.getElementById('training');
    const programNameEl = document.getElementById('programName');
    const programWeekEl = document.getElementById('programWeek');
    const standaloneListEl = document.getElementById('standaloneWorkoutListTraining');

    if (!container) return;

    // Active Workout Resumption Card
    const resumeCardId = 'resumeWorkoutCard';
    let resumeCard = document.getElementById(resumeCardId);

    if (state.activeWorkout) {
        if (!resumeCard) {
            resumeCard = document.createElement('div');
            resumeCard.id = resumeCardId;
            resumeCard.className = 'resume-card mb-4';
            const header = container.querySelector('.header');
            header.after(resumeCard);
        }
        resumeCard.innerHTML = `
            <div class="flex justify-between items-center">
                <div>
                    <div class="resume-card-tag">IN PROGRESS</div>
                    <h3>${escapeHtml(state.activeWorkout.name)}</h3>
                    <p>Tap to resume</p>
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

    // Program dashboard card
    if (!state.currentProgram) {
        if (programNameEl) programNameEl.textContent = 'No Program Selected';
        if (programWeekEl) programWeekEl.textContent = 'Select in Library to see here.';
        // Hide week controls
        const weekControls = document.getElementById('weekControls');
        if (weekControls) weekControls.style.display = 'none';
        // Hide program workout list
        const progWorkoutSection = document.getElementById('programWorkoutSection');
        if (progWorkoutSection) progWorkoutSection.style.display = 'none';
    } else {
        const program = state.programs.find(p => p.id === state.currentProgram);
        if (!program) {
            state.currentProgram = null;
            saveState();
            renderTrainingTab();
            return;
        }
        if (programNameEl) programNameEl.textContent = escapeHtml(program.name);
        if (programWeekEl) programWeekEl.textContent = `Week ${state.currentWeek} of ${program.weeks}`;

        // Week controls
        let weekControls = document.getElementById('weekControls');
        if (!weekControls) {
            weekControls = document.createElement('div');
            weekControls.id = 'weekControls';
            weekControls.className = 'week-controls';
            const dashCard = container.querySelector('.program-dashboard-card');
            if (dashCard) dashCard.appendChild(weekControls);
        }
        weekControls.style.display = 'flex';
        weekControls.innerHTML = `
            <button class="week-btn" onclick="retreatWeek()" ${state.currentWeek <= 1 ? 'disabled' : ''}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="week-progress">
                <div class="week-progress-bar" style="width:${(state.currentWeek / program.weeks) * 100}%"></div>
            </div>
            <button class="week-btn" onclick="advanceWeek()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
        `;

        // Program workout list
        let progSection = document.getElementById('programWorkoutSection');
        if (!progSection) {
            progSection = document.createElement('div');
            progSection.id = 'programWorkoutSection';
            const dashCard = container.querySelector('.program-dashboard-card');
            dashCard.after(progSection);
        }
        progSection.style.display = 'block';

        if (program.workouts.length === 0) {
            progSection.innerHTML = '<div class="empty-state">No workouts in this program yet.</div>';
        } else {
            let rows = '';
            program.workouts.forEach((workout, i) => {
                const lastDate = getLastWorkoutDate(workout.name, program.id, i);
                const lastDoneStr = formatLastDone(lastDate);
                const setTotal = workout.exercises.reduce((acc, ex) => acc + (ex.sets ? ex.sets.length : 0), 0);
                const dayLabel = workout.dayLabel || '';
                rows += `
                    <div class="program-workout-row">
                        <div class="program-workout-info">
                            ${dayLabel ? `<div class="day-label-badge">${escapeHtml(dayLabel)}</div>` : ''}
                            <div class="font-bold">${escapeHtml(workout.name)}</div>
                            <div class="text-secondary text-xs mt-1">${workout.exercises.length} ex • ${setTotal} sets${lastDoneStr ? ` • ${lastDoneStr}` : ''}</div>
                        </div>
                        <button class="btn-secondary btn-sm" onclick="startProgramWorkout(${program.id}, ${i})">Start</button>
                    </div>
                `;
            });
            progSection.innerHTML = `
                <div class="section-title mt-0"><h3>This Week</h3></div>
                <div class="card">${rows}</div>
            `;
        }
    }

    // Standalone workouts
    if (standaloneListEl) {
        standaloneListEl.innerHTML = '';
        if (!state.standaloneWorkouts || state.standaloneWorkouts.length === 0) {
            standaloneListEl.innerHTML = '<div class="empty-state">Design custom routines in the Library tab.</div>';
        } else {
            state.standaloneWorkouts.forEach((workout) => {
                const card = document.createElement('div');
                card.className = 'workout-card';
                const setTotal = workout.exercises.reduce((acc, ex) => acc + (ex.sets ? ex.sets.length : 0), 0);
                const lastDate = getLastWorkoutDate(workout.name, null, null);
                const lastDoneStr = formatLastDone(lastDate);

                card.innerHTML = `
                    <div class="workout-card-header">
                        <h3>${escapeHtml(workout.name)}</h3>
                    </div>
                    <div class="workout-card-meta">
                        ${workout.exercises.length} exercises • ${setTotal} sets${lastDoneStr ? ` • ${lastDoneStr}` : ''}
                    </div>
                `;
                card.addEventListener('click', () => startStandaloneWorkout(workout.id));
                standaloneListEl.appendChild(card);
            });
        }
    }
}

window.startProgramWorkout = function(programId, index) {
    if (state.activeWorkout && !confirm("You have a workout in progress. Start a new one and discard the current one?")) {
        return;
    }

    const program = state.programs.find(p => p.id === programId);
    const template = program.workouts[index];

    const sessionExercises = template.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        restTime: ex.restTime !== undefined ? ex.restTime : getRestTimeForExercise(ex.exerciseId),
        sets: Array.isArray(ex.sets) ? ex.sets.map(s => ({
            weight: '',
            targetReps: s.reps || '',
            reps: '',
            completed: false
        })) : []
    }));

    state.activeWorkout = {
        type: 'program',
        programId: program.id,
        workoutIndex: index,
        week: state.currentWeek || 1,
        name: template.name,
        exercises: sessionExercises,
        notes: ''
    };

    saveState();
    openActiveWorkout();

    const tabBtn = document.querySelector('.tab-btn[data-tab="training"]');
    if (tabBtn) tabBtn.click();
}

function startStandaloneWorkout(id) {
    if (state.activeWorkout && !confirm("You have a workout in progress. Start a new one and discard the current one?")) {
        return;
    }

    const template = state.standaloneWorkouts.find(w => w.id === id);
    if (!template) return;

    const sessionExercises = template.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        restTime: ex.restTime !== undefined ? ex.restTime : getRestTimeForExercise(ex.exerciseId),
        sets: Array.isArray(ex.sets) ? ex.sets.map(s => ({
            weight: '',
            targetReps: s.reps || '',
            reps: '',
            completed: false
        })) : []
    }));

    state.activeWorkout = {
        type: 'standalone',
        standaloneWorkoutId: id,
        name: template.name,
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

    const name = prompt("Name this workout:", "Quick Workout");
    if (name === null) return; // user cancelled

    state.activeWorkout = {
        type: 'freestyle',
        name: name.trim() || 'Quick Workout',
        exercises: [],
        notes: ''
    };
    saveState();
    openActiveWorkout();
}

// --- Active Workout / Logging Logic ---
function openActiveWorkout() {
    const modal = document.getElementById('activeWorkoutModal');
    document.getElementById('activeWorkoutTitle').textContent = escapeHtml(state.activeWorkout.name);
    document.getElementById('workoutNotes').value = state.activeWorkout.notes || '';

    renderActiveExercises();
    modal.classList.add('active');
    renderTrainingTab();
    startWorkoutTimer();
}

function closeActiveWorkout() {
    document.getElementById('activeWorkoutModal').classList.remove('active');
    stopWorkoutTimer();
    renderTrainingTab();
}

function getLastExercisePerformance(exerciseId) {
    const matches = [];
    state.workoutHistory.forEach(workout => {
        const ex = workout.exercises.find(e => e.exerciseId === exerciseId);
        if (ex) {
            matches.push({
                date: workout.date,
                sets: ex.sets
            });
        }
    });

    if (matches.length === 0) return null;

    matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const last = matches[0];
    const bestSet = last.sets.reduce((max, curr) => Number(curr.weight) > Number(max.weight) ? curr : max, last.sets[0]);

    return {
        weight: bestSet.weight,
        reps: bestSet.reps
    };
}

window.updateActiveExerciseRest = function(exIndex, val) {
    state.activeWorkout.exercises[exIndex].restTime = parseInt(val) || 0;
    debouncedSaveState();
}

function renderActiveExercises() {
    const list = document.getElementById('activeExercisesList');
    list.innerHTML = '';

    if (state.activeWorkout.exercises.length === 0) {
        list.innerHTML = '<div class="empty-state">No exercises added yet.<br>Tap "+ Add Exercise" to begin.</div>';
        return;
    }

    const exercisesMap = new Map(state.exercises.map(ex => [ex.id, ex]));

    state.activeWorkout.exercises.forEach((exercise, exIndex) => {
        const exerciseData = exercisesMap.get(exercise.exerciseId);
        const card = document.createElement('div');
        card.className = 'workout-card';

        const exName = exerciseData ? escapeHtml(exerciseData.name) : 'Unknown Exercise';
        const lastPerf = getLastExercisePerformance(exercise.exerciseId);
        const lastPerfHTML = lastPerf ?
            `<span class="badge badge-primary mt-2 mb-1">Last: ${lastPerf.weight} x ${lastPerf.reps}</span>` :
            `<span class="text-xs text-secondary mt-2 mb-1 inline-block">New Exercise</span>`;

        const restTime = exercise.restTime !== undefined ? exercise.restTime : (exerciseData ? exerciseData.restTime : 90);
        
        // Editable inline rest timer per active workout exercise (Updated to White Text)
        const restBadge = `
            <div class="flex items-center gap-1 mt-1" style="color: white;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <input type="text" inputmode="numeric" 
                       style="width: 32px; background: transparent; border: 1px solid var(--border); color: white; font-size: 10px; font-weight: bold; text-align: center; border-radius: 4px; padding: 2px; margin: 0 4px;" 
                       value="${restTime}" 
                       oninput="enforceNumeric(this, false); updateActiveExerciseRest(${exIndex}, this.value)">
                <span class="text-[10px] font-bold uppercase tracking-wider">s rest</span>
            </div>`;

        let setsHTML = `
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 class="text-lg mb-0">${exName}</h3>
                    <div class="flex flex-col items-start">
                        ${lastPerfHTML}
                        ${restBadge}
                    </div>
                </div>
                <button class="btn-icon-sm btn-transparent-danger" onclick="removeActiveExercise(${exIndex})">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="set-row mb-2">
                <span class="set-header text-center">Set</span>
                <span class="set-header text-center">${getWeightUnitLabel().toUpperCase()}</span>
                <span class="set-header text-center">Reps</span>
                <span class="set-header text-center">Done</span>
            </div>
        `;

        exercise.sets.forEach((set, setIndex) => {
            setsHTML += `
                <div class="set-row">
                    <span class="text-center text-secondary font-bold text-sm">${setIndex + 1}</span>
                    <input type="text" inputmode="decimal" value="${set.weight !== undefined ? set.weight : ''}" placeholder="-" 
                        oninput="enforceNumeric(this, true); updateActiveSet(${exIndex}, ${setIndex}, 'weight', this.value)">
                    <input type="text" inputmode="numeric" value="${set.reps !== undefined ? set.reps : ''}" placeholder="${set.targetReps ? set.targetReps : '-'}" 
                        oninput="enforceNumeric(this, false); updateActiveSet(${exIndex}, ${setIndex}, 'reps', this.value)">
                    <button class="set-btn ${set.completed ? 'completed' : ''}" 
                        onclick="toggleSetComplete(${exIndex}, ${setIndex})">
                        ${set.completed ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
                    </button>
                </div>
            `;
        });

        card.innerHTML = `
            ${setsHTML}
            <button class="btn-dashed mt-4" onclick="addSetToActive(${exIndex})">+ Add Set</button>
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
    const wasCompleted = set.completed;
    set.completed = !set.completed;
    renderActiveExercises();
    saveState();

    // Start rest timer when marking set as complete (not when un-completing)
    if (!wasCompleted && set.completed) {
        const exercise = state.activeWorkout.exercises[exIndex];
        const exerciseData = state.exercises.find(e => e.id === exercise.exerciseId);
        const exerciseName = exerciseData ? exerciseData.name : 'Exercise';
        const duration = exercise.restTime !== undefined ? exercise.restTime : (exerciseData ? exerciseData.restTime : 90);
        
        startRestTimer(duration, exerciseName);
    }
};

window.addSetToActive = function(exIndex) {
    const previousSet = state.activeWorkout.exercises[exIndex].sets[state.activeWorkout.exercises[exIndex].sets.length - 1];
    state.activeWorkout.exercises[exIndex].sets.push({
        weight: previousSet ? previousSet.weight : '',
        reps: '',
        targetReps: previousSet ? previousSet.targetReps : '',
        completed: false
    });
    renderActiveExercises();
    saveState();
};

window.removeActiveExercise = function(exIndex) {
    if (confirm('Remove this exercise?')) {
        state.activeWorkout.exercises.splice(exIndex, 1);
        renderActiveExercises();
        saveState();
    }
};

function discardWorkout() {
    if (confirm("Are you sure you want to cancel this workout? All progress will be discarded.")) {
        state.activeWorkout = null;
        saveState();
        stopWorkoutTimer();
        document.getElementById('activeWorkoutModal').classList.remove('active');
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

    if (state.activeWorkout.historyId) {
        const index = state.workoutHistory.findIndex(w => w.id === state.activeWorkout.historyId);
        if (index !== -1) {
            state.workoutHistory[index].exercises = completedExercises;
            state.workoutHistory[index].notes = state.activeWorkout.notes || '';
        }
    } else {
        const record = {
            id: Date.now(),
            date: new Date().toISOString(),
            programId: state.activeWorkout.programId || null,
            workoutIndex: state.activeWorkout.workoutIndex,
            week: state.activeWorkout.week || 1,
            name: state.activeWorkout.name,
            exercises: completedExercises,
            notes: state.activeWorkout.notes || ''
        };
        state.workoutHistory.push(record);
    }

    state.activeWorkout = null;
    saveState();
    stopWorkoutTimer();

    document.getElementById('activeWorkoutModal').classList.remove('active');
    renderHistory();
    renderTrainingTab();
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

function renderProgramBuilderWorkouts() {
    const builder = document.getElementById('workoutBuilder');
    builder.innerHTML = '';

    if (state.editingProgram.workouts.length === 0) {
        builder.innerHTML = '<div class="empty-state">No workouts added yet.</div>';
        return;
    }

    const exercisesMap = new Map(state.exercises.map(ex => [ex.id, ex]));

    state.editingProgram.workouts.forEach((workout, i) => {
        const details = document.createElement('details');
        details.className = 'category-group draggable-item';
        details.dataset.index = i;
        details.open = true;

        const summary = document.createElement('summary');
        const dayLabel = workout.dayLabel ? `<span class="day-label-badge">${escapeHtml(workout.dayLabel)}</span>` : '';
        summary.innerHTML = `
            <span class="drag-handle mr-2" title="Drag to reorder" onclick="event.preventDefault(); event.stopPropagation();">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
            </span>
            <div class="flex flex-grow justify-between items-center w-full">
                <div>
                    <span class="font-bold">${escapeHtml(workout.name)}</span>
                    ${dayLabel}
                </div>
                <span class="text-secondary text-sm">${workout.exercises.length} ex</span>
            </div>
        `;

        const content = document.createElement('div');
        content.className = 'category-content';

        if (workout.exercises.length > 0) {
            workout.exercises.forEach(ex => {
                const exData = exercisesMap.get(ex.exerciseId);
                const row = document.createElement('div');
                const setTotal = ex.sets ? ex.sets.length : 0;
                row.className = 'exercise-item-row';
                row.innerHTML = `
                    <span class="text-secondary text-sm">${exData ? escapeHtml(exData.name) : 'Unknown'}</span>
                    <span class="text-sm font-medium">${setTotal} sets</span>
                `;
                content.appendChild(row);
            });
        } else {
            content.innerHTML = '<div class="text-center text-sm text-secondary py-2">No exercises added.</div>';
        }

        const controls = document.createElement('div');
        controls.className = 'builder-controls';
        controls.innerHTML = `
            <button class="btn-secondary btn-sm" onclick="event.preventDefault(); openWorkoutBuilder(null, ${i}, 'program')">Edit</button>
            <button class="btn-text-danger btn-sm ml-auto" onclick="event.preventDefault(); removeWorkoutFromProgram(${i})">Delete</button>
        `;

        content.appendChild(controls);
        details.appendChild(summary);
        details.appendChild(content);

        builder.appendChild(details);
    });

    initDragToReorder(builder, 'editingProgram');
}

function closeProgramBuilder() {
    document.getElementById('programBuilderModal').classList.remove('active');
    state.editingProgram = null;
}

function addWorkoutToProgram() {
    openWorkoutBuilder(null, null, 'program');
}

window.advanceWeek = function() {
    const program = state.programs.find(p => p.id === state.currentProgram);
    if (!program) return;
    if (state.currentWeek < program.weeks) {
        state.currentWeek++;
        saveState();
        renderTrainingTab();
    } else {
        if (confirm("You have completed all " + program.weeks + " weeks! Mark program as done and reset to Week 1?")) {
            state.currentWeek = 1;
            saveState();
            renderTrainingTab();
        }
    }
};

window.retreatWeek = function() {
    if (state.currentWeek > 1) {
        state.currentWeek--;
        saveState();
        renderTrainingTab();
    }
};

window.removeWorkoutFromProgram = function(index) {
    state.editingProgram.workouts.splice(index, 1);
    renderProgramBuilderWorkouts();
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

// --- Workout Builder Logic (Program & Standalone) ---
window.openWorkoutBuilder = function(workoutToEdit = null, workoutIndex = null, context = 'program') {
    const modal = document.getElementById('workoutBuilderModal');
    state.workoutBuilderContext = context;

    if (context === 'program') {
        if (workoutIndex !== null) {
            state.editingWorkout = deepClone(state.editingProgram.workouts[workoutIndex]);
            state.editingWorkout.index = workoutIndex;
        } else {
            state.editingWorkout = {
                name: '',
                exercises: []
            };
        }
    } else if (context === 'standalone') {
        if (workoutToEdit) {
            state.editingWorkout = deepClone(workoutToEdit);
        } else {
            state.editingWorkout = {
                id: Date.now(),
                name: '',
                exercises: []
            };
        }
    }

    document.getElementById('workoutNameInput').value = state.editingWorkout.name;
    const dayLabelInput = document.getElementById('workoutDayLabelInput');
    if (dayLabelInput) dayLabelInput.value = state.editingWorkout.dayLabel || '';
    renderWorkoutBuilderExercises();

    modal.classList.add('active');
};

// --- SortableJS Drag to Reorder ---
function initDragToReorder(container, stateKey) {
    if (typeof Sortable === 'undefined') return;

    new Sortable(container, {
        handle: '.drag-handle', // Drag using the dots icon
        animation: 150, // Smooth slide animation
        ghostClass: 'drag-target', // Visual class for item being dragged
        onEnd: function (evt) {
            const fromIndex = evt.oldIndex;
            const toIndex = evt.newIndex;
            
            // If dropped in the same place, do nothing
            if (fromIndex === toIndex) return;

            // Reorder the underlying data array
            if (stateKey === 'editingWorkout') {
                const arr = state.editingWorkout.exercises;
                const [moved] = arr.splice(fromIndex, 1);
                arr.splice(toIndex, 0, moved);
                renderWorkoutBuilderExercises();
            } else if (stateKey === 'editingProgram') {
                const arr = state.editingProgram.workouts;
                const [moved] = arr.splice(fromIndex, 1);
                arr.splice(toIndex, 0, moved);
                renderProgramBuilderWorkouts();
            }
        }
    });
}

window.updateBuilderExerciseRest = function(exIndex, value) {
    state.editingWorkout.exercises[exIndex].restTime = parseInt(value) || 0;
};

function renderWorkoutBuilderExercises() {
    const builder = document.getElementById('exerciseBuilder');
    builder.innerHTML = '';
    
    const exercisesMap = new Map(state.exercises.map(ex => [ex.id, ex]));

    state.editingWorkout.exercises.forEach((ex, i) => {
        const exerciseData = exercisesMap.get(ex.exerciseId);
        const item = document.createElement('div');
        item.className = 'builder-item draggable-item';
        item.dataset.index = i;
        
        const currentRestTime = ex.restTime !== undefined ? ex.restTime : (exerciseData ? exerciseData.restTime : 90);

        let setsHTML = `<div class="mt-4">`;
        
        // Custom Per-Workout Rest Timer Configuration
        setsHTML += `
            <div class="flex items-center justify-between mb-3 pb-2" style="border-bottom: 1px solid var(--border);">
                <span class="text-xs text-secondary font-medium uppercase tracking-wide">Workout Rest Timer</span>
                <div class="flex items-center gap-1">
                    <input type="text" inputmode="numeric" class="input-field text-center p-1" style="width: 50px; min-height: 0; font-size: 13px;" value="${currentRestTime}" oninput="enforceNumeric(this, false); updateBuilderExerciseRest(${i}, this.value)">
                    <span class="text-xs text-secondary">sec</span>
                </div>
            </div>
        `;

        if (ex.sets && ex.sets.length > 0) {
            ex.sets.forEach((set, setIndex) => {
                setsHTML += `
                    <div class="flex gap-2 mb-2 items-center">
                        <span class="text-xs text-secondary w-8">Set ${setIndex+1}</span>
                        <input type="text" class="input-field py-2 flex-grow text-center" placeholder="Reps / Range (e.g. 8-12)" value="${set.reps !== undefined ? set.reps : ''}" oninput="enforceRepRange(this); updateBuilderSet(${i}, ${setIndex}, 'reps', this.value)">
                        <button class="btn-icon-xs btn-transparent-danger" onclick="removeBuilderSet(${i}, ${setIndex})">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                `;
            });
        }
        setsHTML += `<button class="btn-dashed btn-sm w-full mt-2" onclick="addBuilderSet(${i})">+ Add Set</button></div>`;

        item.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <div class="flex items-center gap-2">
                    <span class="drag-handle" title="Drag to reorder">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                    </span>
                    <strong class="text-sm">${exerciseData ? escapeHtml(exerciseData.name) : 'Unknown'}</strong>
                </div>
                <button class="btn-icon-xs btn-transparent-danger" onclick="removeExerciseFromBuilder(${i})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            ${setsHTML}
        `;
        builder.appendChild(item);
    });

    initDragToReorder(builder, 'editingWorkout');
}

window.updateBuilderSet = function(exIndex, setIndex, field, value) {
    state.editingWorkout.exercises[exIndex].sets[setIndex][field] = value;
};
window.removeBuilderSet = function(exIndex, setIndex) {
    state.editingWorkout.exercises[exIndex].sets.splice(setIndex, 1);
    renderWorkoutBuilderExercises();
};
window.addBuilderSet = function(exIndex) {
    const ex = state.editingWorkout.exercises[exIndex];
    const lastSet = ex.sets[ex.sets.length - 1];
    ex.sets.push({
        reps: lastSet && lastSet.reps !== undefined ? lastSet.reps : ''
    });
    renderWorkoutBuilderExercises();
};

window.removeExerciseFromBuilder = function(index) {
    state.editingWorkout.exercises.splice(index, 1);
    renderWorkoutBuilderExercises();
};

function closeWorkoutBuilder() {
    document.getElementById('workoutBuilderModal').classList.remove('active');
    state.editingWorkout = null;
    state.workoutBuilderContext = null;
}

function saveWorkout() {
    const name = document.getElementById('workoutNameInput').value.trim();
    if (!name) return alert("Workout name required");

    // Validate no exercises with 0 sets
    const emptyExercises = state.editingWorkout.exercises.filter(ex => !ex.sets || ex.sets.length === 0);
    if (emptyExercises.length > 0) {
        const names = emptyExercises.map(ex => {
            const d = state.exercises.find(e => e.id === ex.exerciseId);
            return d ? d.name : 'Unknown';
        }).join(', ');
        return alert(`These exercises have no sets: ${names}. Add at least 1 set or remove them.`);
    }

    state.editingWorkout.name = name;
    const dayLabelEl = document.getElementById('workoutDayLabelInput');
    if (dayLabelEl) state.editingWorkout.dayLabel = dayLabelEl.value.trim();

    if (state.workoutBuilderContext === 'program') {
        if (state.editingWorkout.index !== undefined && state.editingWorkout.index !== null) {
            state.editingProgram.workouts[state.editingWorkout.index] = state.editingWorkout;
        } else {
            state.editingProgram.workouts.push(state.editingWorkout);
        }
        renderProgramBuilderWorkouts();
    } else if (state.workoutBuilderContext === 'standalone') {
        const existingIndex = state.standaloneWorkouts.findIndex(w => w.id === state.editingWorkout.id);
        if (existingIndex >= 0) {
            state.standaloneWorkouts[existingIndex] = state.editingWorkout;
        } else {
            state.standaloneWorkouts.push(state.editingWorkout);
        }
        saveState();
        renderStandaloneWorkoutsList();
        renderTrainingTab();
    }

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

    const categories = {};
    filtered.forEach(ex => {
        const rawCat = ex.category || 'Other';
        const cat = rawCat.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(ex);
    });

    const sortedCategories = Object.keys(categories).sort();

    sortedCategories.forEach(cat => {
        const exercises = categories[cat];

        const catHeader = document.createElement('div');
        catHeader.className = 'section-title-sm';
        catHeader.textContent = cat;
        list.appendChild(catHeader);

        exercises.forEach(exercise => {
            const item = document.createElement('div');
            item.className = 'builder-item clickable';
            item.innerHTML = `
                <h4 class="text-md">${escapeHtml(exercise.name)}</h4>
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
            restTime: exercise.restTime || 90,
            sets: []
        });
        renderWorkoutBuilderExercises();
    } else if (state.exerciseSelectionSource === 'activeWorkout') {
        state.activeWorkout.exercises.push({
            exerciseId: exercise.id,
            restTime: exercise.restTime || 90,
            sets: [{
                weight: '',
                reps: '',
                targetReps: '',
                completed: false
            }]
        });
        saveState();
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
        const details = document.createElement('details');
        details.className = 'category-group';
        details.open = false;

        const summary = document.createElement('summary');
        summary.innerHTML = `
            <div class="flex flex-grow justify-between items-center w-full">
                <div>
                    <h3 class="mb-0">${escapeHtml(program.name)}</h3>
                    <span class="text-secondary text-sm">${program.workouts.length} workouts</span>
                </div>
                <div class="flex gap-2">
                    <button class="btn-secondary btn-sm" onclick="event.preventDefault(); event.stopPropagation(); editProgram(${program.id})">Edit</button>
                    <button class="btn-text-danger btn-sm" onclick="event.preventDefault(); event.stopPropagation(); deleteProgram(${program.id})">Del</button>
                </div>
            </div>
        `;

        const content = document.createElement('div');
        content.className = 'category-content';

        if (program.workouts.length === 0) {
            content.innerHTML = '<div class="text-center text-sm text-secondary py-2">No workouts in this program.</div>';
        } else {
            program.workouts.forEach((workout, i) => {
                const row = document.createElement('div');
                row.className = 'exercise-item-row';
                row.innerHTML = `
                    <span class="font-medium">${escapeHtml(workout.name)}</span>
                    <button class="btn-primary btn-sm" onclick="startProgramWorkout(${program.id}, ${i})">Start</button>
                `;
                content.appendChild(row);
            });
        }

        details.appendChild(summary);
        details.appendChild(content);
        list.appendChild(details);
    });
}

function renderStandaloneWorkoutsList() {
    const list = document.getElementById('standaloneList');
    if (!list) return;
    list.innerHTML = '';

    if (!state.standaloneWorkouts || state.standaloneWorkouts.length === 0) {
        list.innerHTML = '<div class="empty-state">No standalone workouts created yet.</div>';
        return;
    }

    state.standaloneWorkouts.forEach(workout => {
        const card = document.createElement('div');
        card.className = 'card';

        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="mb-2">${escapeHtml(workout.name)}</h3>
                    <p class="text-secondary text-sm mb-4">${workout.exercises.length} exercises</p>
                </div>
            </div>
            <div class="flex gap-2 flex-wrap">
                <button class="btn-secondary btn-sm" onclick="startStandaloneWorkout(${workout.id})">Start</button>
                <button class="btn-secondary btn-sm" onclick="editStandaloneWorkout(${workout.id})">Edit</button>
                <button class="btn-text-danger btn-sm ml-auto" onclick="deleteStandaloneWorkout(${workout.id})">Delete</button>
            </div>
        `;
        list.appendChild(card);
    });
}

window.editStandaloneWorkout = function(id) {
    const workout = state.standaloneWorkouts.find(w => w.id === id);
    if (workout) openWorkoutBuilder(workout, null, 'standalone');
}

window.deleteStandaloneWorkout = function(id) {
    if (confirm('Delete this standalone workout?')) {
        state.standaloneWorkouts = state.standaloneWorkouts.filter(w => w.id !== id);
        saveState();
        renderStandaloneWorkoutsList();
        renderTrainingTab();
    }
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

function renderExercisesList(filter = '') {
    const list = document.getElementById('exercisesList');
    list.innerHTML = '';

    const filtered = state.exercises.filter(e =>
        e.name.toLowerCase().includes(filter.toLowerCase())
    );

    const categories = {};
    filtered.forEach(ex => {
        const rawCat = ex.category || 'Other';
        const cat = rawCat.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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

        const details = document.createElement('details');
        details.className = 'category-group';
        details.open = true;

        const summary = document.createElement('summary');
        summary.innerHTML = `
            <span class="font-bold text-primary">${cat}</span>
            <span class="text-secondary text-sm ml-auto">${exercises.length}</span>
        `;
        details.appendChild(summary);

        const content = document.createElement('div');
        content.className = 'category-content';

        exercises.forEach(exercise => {
            const card = document.createElement('div');
            card.className = 'exercise-item-row';
            card.innerHTML = `
                <h4>${escapeHtml(exercise.name)}</h4>
                <button class="btn-icon-xs btn-transparent-danger" onclick="deleteExercise(${exercise.id})">
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
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
    const restTimeEl = document.getElementById('exerciseRestInput');
    const restTime = restTimeEl ? parseInt(restTimeEl.value) || 90 : 90;

    if (!name) {
        alert('Name required');
        return;
    }

    state.exercises.push({
        id: Date.now(),
        name,
        category,
        restTime
    });
    saveState();
    closeAddExercise();
    renderExercisesList();
}
// --- Settings Preferences ---
function renderSettingsPreferences() {
    const unit = state.weightUnit || 'lbs';
    const lbsBtn = document.getElementById('unitLbs');
    const kgBtn = document.getElementById('unitKg');
    if (lbsBtn) lbsBtn.classList.toggle('active', unit === 'lbs');
    if (kgBtn) kgBtn.classList.toggle('active', unit === 'kg');
}

// --- Progress Tab & Charts ---
let chartInstances = {};

function renderProgressTab() {
    renderBodyweightChart();
    renderStrengthChart();
    populateProgressExerciseSelect();
}

function populateProgressExerciseSelect() {
    const sel = document.getElementById('progressExerciseSelect');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">Select an exercise...</option>';

    // Only show exercises that have history
    const exercisesWithHistory = new Set();
    state.workoutHistory.forEach(w => {
        w.exercises.forEach(ex => exercisesWithHistory.add(ex.exerciseId));
    });

    const sorted = [...state.exercises]
        .filter(e => exercisesWithHistory.has(e.id))
        .sort((a, b) => a.name.localeCompare(b.name));

    sorted.forEach(ex => {
        const opt = document.createElement('option');
        opt.value = ex.id;
        opt.textContent = ex.name;
        sel.appendChild(opt);
    });

    if (currentVal) sel.value = currentVal;

    sel.onchange = () => renderStrengthChart(parseInt(sel.value));
}

function getChartColors() {
    return {
        primary: '#3b82f6',
        primaryAlpha: 'rgba(59, 130, 246, 0.15)',
        success: '#10b981',
        successAlpha: 'rgba(16, 185, 129, 0.15)',
        warning: '#f59e0b',
        warningAlpha: 'rgba(245, 158, 11, 0.15)',
        grid: 'rgba(255,255,255,0.06)',
        text: '#a1a1aa'
    };
}

function destroyChart(key) {
    if (chartInstances[key]) {
        chartInstances[key].destroy();
        chartInstances[key] = null;
    }
}

function baseChartConfig(labels, datasets) {
    const c = getChartColors();
    return {
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#18181b',
                    borderColor: '#27272a',
                    borderWidth: 1,
                    titleColor: '#fafafa',
                    bodyColor: '#a1a1aa',
                    padding: 12,
                    cornerRadius: 0,
                }
            },
            scales: {
                x: {
                    grid: {
                        color: c.grid
                    },
                    ticks: {
                        color: c.text,
                        font: {
                            size: 11
                        },
                        maxTicksLimit: 6
                    },
                    border: {
                        color: c.grid
                    }
                },
                y: {
                    grid: {
                        color: c.grid
                    },
                    ticks: {
                        color: c.text,
                        font: {
                            size: 11
                        }
                    },
                    border: {
                        color: c.grid
                    }
                }
            }
        }
    };
}

function renderBodyweightChart() {
    const canvas = document.getElementById('bodyweightChart');
    const empty = document.getElementById('bodyweightChartEmpty');
    if (!canvas) return;

    destroyChart('bodyweight');

    const data = [...(state.bodyweightHistory || [])].sort((a, b) => new Date(a.date) - new Date(b.date));

    if (data.length < 2) {
        canvas.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    canvas.style.display = 'block';
    if (empty) empty.style.display = 'none';

    const c = getChartColors();
    const labels = data.map(d => new Date(d.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
    }));
    const values = data.map(d => d.weight);

    const cfg = baseChartConfig(labels, [{
        label: `Weight (${getWeightUnitLabel()})`,
        data: values,
        borderColor: c.success,
        backgroundColor: c.successAlpha,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: c.success,
        pointBorderColor: '#09090b',
        pointBorderWidth: 2,
    }]);
    cfg.type = 'line';
    chartInstances['bodyweight'] = new Chart(canvas, cfg);
}

function renderStrengthChart(exerciseId) {
    const canvas = document.getElementById('strengthChart');
    const empty = document.getElementById('strengthChartEmpty');
    if (!canvas) return;

    destroyChart('strength');

    if (!exerciseId) {
        canvas.style.display = 'none';
        if (empty) {
            empty.style.display = 'flex';
        }
        return;
    }

    // Gather best set (highest weight) per workout session for this exercise
    const sessions = [];
    state.workoutHistory.forEach(w => {
        const ex = w.exercises.find(e => e.exerciseId === exerciseId);
        if (!ex || !ex.sets.length) return;
        const best = ex.sets.reduce((max, s) => (Number(s.weight) > Number(max.weight) ? s : max), ex.sets[0]);
        if (best.weight) {
            sessions.push({
                date: w.date,
                weight: Number(best.weight),
                reps: Number(best.reps) || 0
            });
        }
    });

    sessions.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (sessions.length < 1) {
        canvas.style.display = 'none';
        if (empty) {
            empty.style.display = 'flex';
        }
        return;
    }

    canvas.style.display = 'block';
    if (empty) empty.style.display = 'none';

    const c = getChartColors();
    const labels = sessions.map(s => new Date(s.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
    }));

    const cfg = baseChartConfig(labels, [{
        label: `Best Weight (${getWeightUnitLabel()})`,
        data: sessions.map(s => s.weight),
        borderColor: c.primary,
        backgroundColor: c.primaryAlpha,
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointBackgroundColor: c.primary,
        pointBorderColor: '#09090b',
        pointBorderWidth: 2,
    }]);
    cfg.type = 'line';
    chartInstances['strength'] = new Chart(canvas, cfg);
}
