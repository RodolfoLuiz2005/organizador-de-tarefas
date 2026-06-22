/*
  Activity Flow - HTML, CSS e JavaScript puro.
  A activityRepository concentra persistência para uma troca futura por Firebase/Firestore.
*/

const STORAGE_KEY = "activity-flow.activities.v1";
const BRASILIA_TIME_ZONE = "America/Sao_Paulo";
const LOCK_MINUTES_AFTER_MIDNIGHT = 20;

const statusMap = { pending: "Pendente", completed: "Concluída" };
const unitMap = {
  minutes: { singular: "minuto", plural: "minutos", minutesFactor: 1 },
  hours: { singular: "hora", plural: "horas", minutesFactor: 60 },
  days: { singular: "dia", plural: "dias", minutesFactor: 1440 },
};

const activityRepository = {
  async getAll() {
    try {
      const rawData = localStorage.getItem(STORAGE_KEY);
      const parsedData = rawData ? JSON.parse(rawData) : [];

      if (!Array.isArray(parsedData)) return [];

      const today = getTodayBrasiliaISO();
      const normalized = parsedData
        .map((activity, index) => normalizeActivity(activity, index, today))
        .filter(Boolean);

      if (JSON.stringify(normalized) !== JSON.stringify(parsedData)) {
        await this.saveAll(normalized, { silent: true });
      }

      return normalized;
    } catch (error) {
      console.error("Erro ao carregar atividades do localStorage:", error);
      showToast({
        title: "Dados não carregados",
        message: "O armazenamento local retornou dados inválidos. A lista foi iniciada vazia.",
        type: "error",
      });
      return [];
    }
  },

  async saveAll(activities, options = {}) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activities));
      return true;
    } catch (error) {
      console.error("Erro ao salvar atividades no localStorage:", error);
      if (!options.silent) {
        showToast({
          title: "Erro ao salvar",
          message: "Não foi possível salvar os dados no navegador.",
          type: "error",
        });
      }
      return false;
    }
  },

  async create(activity, activities) {
    const nextActivities = [activity, ...activities];
    return (await this.saveAll(nextActivities)) ? nextActivities : null;
  },

  async update(activityId, changes, activities) {
    const nextActivities = activities.map((activity) =>
      activity.id === activityId ? { ...activity, ...changes, updatedAt: new Date().toISOString() } : activity
    );
    return (await this.saveAll(nextActivities)) ? nextActivities : null;
  },

  async delete(activityId, activities) {
    const nextActivities = activities.filter((activity) => activity.id !== activityId);
    return (await this.saveAll(nextActivities)) ? nextActivities : null;
  },
};

const state = {
  activities: [],
  currentFilter: "all",
  editingId: null,
  selectedDate: getTodayBrasiliaISO(),
  visibleMonth: getMonthKey(getTodayBrasiliaISO()),
};

const elements = {
  form: document.querySelector("#activityForm"),
  formTitle: document.querySelector("#formTitle"),
  nameInput: document.querySelector("#activityName"),
  dateInput: document.querySelector("#activityDate"),
  durationInput: document.querySelector("#activityDuration"),
  unitSelect: document.querySelector("#activityUnit"),
  submitButton: document.querySelector("#submitButton"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  formFeedback: document.querySelector("#formFeedback"),
  activityList: document.querySelector("#activityList"),
  activityListDescription: document.querySelector("#activityListDescription"),
  emptyState: document.querySelector("#emptyState"),
  filterButtons: document.querySelectorAll(".filter-btn"),
  totalActivities: document.querySelector("#totalActivities"),
  pendingActivities: document.querySelector("#pendingActivities"),
  completedActivities: document.querySelector("#completedActivities"),
  totalTime: document.querySelector("#totalTime"),
  dayTotalActivities: document.querySelector("#dayTotalActivities"),
  dayPendingActivities: document.querySelector("#dayPendingActivities"),
  dayCompletedActivities: document.querySelector("#dayCompletedActivities"),
  dayTotalTime: document.querySelector("#dayTotalTime"),
  selectedDateLabel: document.querySelector("#selectedDateLabel"),
  selectedDateStatus: document.querySelector("#selectedDateStatus"),
  lockedDayMessage: document.querySelector("#lockedDayMessage"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  previousMonthButton: document.querySelector("#previousMonthButton"),
  nextMonthButton: document.querySelector("#nextMonthButton"),
  previousDayButton: document.querySelector("#previousDayButton"),
  todayButton: document.querySelector("#todayButton"),
  nextDayButton: document.querySelector("#nextDayButton"),
  shareDayButton: document.querySelector("#shareDayButton"),
  toastContainer: document.querySelector("#toastContainer"),
};

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  state.activities = await activityRepository.getAll();
  elements.dateInput.value = state.selectedDate;
  bindEvents();
  initRevealAnimations();
  renderApp();
  showToast({ title: "Sistema carregado", message: "Suas atividades foram sincronizadas com este navegador.", type: "info", duration: 2600 });
}
function bindEvents() {
  elements.form.addEventListener("submit", handleFormSubmit);
  elements.cancelEditButton.addEventListener("click", resetFormMode);
  elements.activityList.addEventListener("click", handleActivityAction);
  elements.calendarGrid.addEventListener("click", handleCalendarClick);
  elements.previousMonthButton.addEventListener("click", () => changeVisibleMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => changeVisibleMonth(1));
  elements.previousDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, -1)));
  elements.nextDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, 1)));
  elements.todayButton.addEventListener("click", () => selectDate(getTodayBrasiliaISO()));
  elements.shareDayButton.addEventListener("click", shareSelectedDayActivities);
  elements.dateInput.addEventListener("change", () => {
    if (isValidISODate(elements.dateInput.value) && !state.editingId) selectDate(elements.dateInput.value);
    else syncFormAvailability();
  });
  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentFilter = button.dataset.filter;
      updateActiveFilter();
      renderActivities();
    });
  });
  window.addEventListener("storage", async (event) => {
    if (event.key === STORAGE_KEY) {
      state.activities = await activityRepository.getAll();
      renderApp();
    }
  });
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const formData = getSanitizedFormData();
  const validation = validateActivityData(formData);

  if (!validation.isValid) {
    showFormFeedback(validation.message, "error");
    return;
  }

  if (isDateLocked(formData.date)) {
    showFormFeedback("Este dia já foi encerrado e não pode receber alterações.", "error");
    showLockedToast();
    return;
  }

  if (state.editingId) await updateActivity(state.editingId, formData);
  else await createActivity(formData);
}

function getSanitizedFormData() {
  return {
    name: elements.nameInput.value.trim().replace(/\s+/g, " "),
    date: elements.dateInput.value,
    duration: Number(elements.durationInput.value),
    unit: elements.unitSelect.value,
  };
}

function validateActivityData(data) {
  if (!data.name || !data.date || !data.duration || !data.unit) {
    return { isValid: false, message: "Preencha o nome, a data, a duração e a unidade de tempo." };
  }
  if (data.name.length < 2) return { isValid: false, message: "O nome da atividade precisa ter pelo menos 2 caracteres." };
  if (!isValidISODate(data.date)) return { isValid: false, message: "Informe uma data válida no formato esperado." };
  if (Number.isNaN(data.duration) || data.duration <= 0 || data.duration > 10000) {
    return { isValid: false, message: "Informe uma duração maior que zero e dentro de um limite realista." };
  }
  if (!unitMap[data.unit]) return { isValid: false, message: "Selecione uma unidade de tempo válida." };
  return { isValid: true, message: "" };
}

async function createActivity(data) {
  const newActivity = {
    id: createId(),
    name: data.name,
    date: data.date,
    duration: data.duration,
    unit: data.unit,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const nextActivities = await activityRepository.create(newActivity, state.activities);
  if (!nextActivities) return;
  state.activities = nextActivities;
  selectDate(newActivity.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({ title: "Atividade adicionada", message: `"${newActivity.name}" foi cadastrada para ${formatDateForHuman(newActivity.date)}.`, type: "success" });
}

async function updateActivity(activityId, data) {
  const activity = findActivity(activityId);
  if (!activity) {
    showToast({ title: "Atividade não encontrada", message: "Não foi possível editar esta atividade.", type: "error" });
    resetFormMode();
    return;
  }
  if (!canChangeActivity(activity)) return;

  const nextActivities = await activityRepository.update(activityId, {
    name: data.name,
    date: data.date,
    duration: data.duration,
    unit: data.unit,
  }, state.activities);
  if (!nextActivities) return;
  state.activities = nextActivities;
  selectDate(data.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({ title: "Atividade atualizada", message: "As alterações foram salvas com sucesso.", type: "success" });
}

async function toggleActivityStatus(activityId) {
  const activity = findActivity(activityId);
  if (!activity || !canChangeActivity(activity)) return;
  const nextStatus = activity.status === "completed" ? "pending" : "completed";
  const nextActivities = await activityRepository.update(activityId, { status: nextStatus }, state.activities);
  if (!nextActivities) return;
  state.activities = nextActivities;
  renderApp();
  showToast({
    title: nextStatus === "completed" ? "Atividade concluída" : "Atividade reaberta",
    message: nextStatus === "completed" ? "A atividade foi marcada como concluída." : "A atividade voltou para pendente.",
    type: "success",
  });
}

function startEditActivity(activityId) {
  const activity = findActivity(activityId);
  if (!activity || !canChangeActivity(activity)) return;
  state.editingId = activityId;
  elements.nameInput.value = activity.name;
  elements.dateInput.value = activity.date;
  elements.durationInput.value = activity.duration;
  elements.unitSelect.value = activity.unit;
  elements.formTitle.textContent = "Editar atividade";
  elements.submitButton.textContent = "Salvar alterações";
  elements.cancelEditButton.classList.remove("is-hidden");
  clearFormFeedback();
  syncFormAvailability();
  elements.nameInput.focus();
  elements.form.scrollIntoView({ behavior: "smooth", block: "center" });
}
async function deleteActivity(activityId) {
  const activity = findActivity(activityId);
  if (!activity || !canChangeActivity(activity)) return;
  if (!confirm(`Deseja excluir a atividade "${activity.name}"?`)) return;

  const selector = typeof CSS !== "undefined" && CSS.escape
    ? `[data-activity-id="${CSS.escape(activityId)}"]`
    : `[data-activity-id="${activityId.replaceAll('"', '\\"')}"]`;
  const card = document.querySelector(selector);
  if (card) {
    card.classList.add("is-removing");
    await wait(220);
  }

  const nextActivities = await activityRepository.delete(activityId, state.activities);
  if (!nextActivities) return;
  state.activities = nextActivities;
  if (state.editingId === activityId) resetFormMode();
  renderApp();
  showToast({ title: "Atividade excluída", message: "A atividade foi removida com segurança.", type: "success" });
}

function handleActivityAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const activityId = button.closest("[data-activity-id]")?.dataset.activityId;
  if (!activityId) return;
  const actions = { toggle: toggleActivityStatus, edit: startEditActivity, delete: deleteActivity };
  actions[button.dataset.action]?.(activityId);
}

function handleCalendarClick(event) {
  const button = event.target.closest("[data-date]");
  if (button) selectDate(button.dataset.date);
}

function changeVisibleMonth(offset) {
  const { year, month } = parseMonthKey(state.visibleMonth);
  state.visibleMonth = toISODate(new Date(Date.UTC(year, month - 1 + offset, 1))).slice(0, 7);
  renderCalendar();
}

function selectDate(dateString, options = {}) {
  if (!isValidISODate(dateString)) return;
  state.selectedDate = dateString;
  state.visibleMonth = getMonthKey(dateString);
  if (!state.editingId) elements.dateInput.value = dateString;
  if (options.render !== false) renderApp();
}

function resetFormMode() {
  state.editingId = null;
  elements.form.reset();
  elements.dateInput.value = state.selectedDate;
  elements.unitSelect.value = "hours";
  elements.formTitle.textContent = "Adicionar atividade";
  elements.submitButton.textContent = "Adicionar atividade";
  elements.cancelEditButton.classList.add("is-hidden");
  clearFormFeedback();
  syncFormAvailability();
}

function renderApp() {
  renderSummary();
  renderSelectedDateHeader();
  renderDaySummary();
  renderCalendar();
  updateActiveFilter();
  renderActivities();
  syncFormAvailability();
}

function renderSummary() {
  const total = state.activities.length;
  const completed = state.activities.filter((activity) => activity.status === "completed").length;
  const pending = total - completed;
  setCounterValue(elements.totalActivities, total);
  setCounterValue(elements.pendingActivities, pending);
  setCounterValue(elements.completedActivities, completed);
  setCounterValue(elements.totalTime, formatTotalTime(sumDurationMinutes(state.activities)));
}

function renderSelectedDateHeader() {
  const locked = isDateLocked(state.selectedDate);
  const dayActivities = getActivitiesByDate(state.selectedDate);
  elements.selectedDateLabel.textContent = formatDateForHuman(state.selectedDate, { includeWeekday: true });
  elements.selectedDateStatus.textContent = locked
    ? "Dia encerrado para alterações"
    : `${dayActivities.length} atividade${dayActivities.length === 1 ? "" : "s"} na data`;
  elements.lockedDayMessage.classList.toggle("is-visible", locked);
}

function renderDaySummary() {
  const dayActivities = getActivitiesByDate(state.selectedDate);
  const total = dayActivities.length;
  const completed = dayActivities.filter((activity) => activity.status === "completed").length;
  const pending = total - completed;
  setCounterValue(elements.dayTotalActivities, total);
  setCounterValue(elements.dayPendingActivities, pending);
  setCounterValue(elements.dayCompletedActivities, completed);
  setCounterValue(elements.dayTotalTime, formatTotalTime(sumDurationMinutes(dayActivities)));
  elements.activityListDescription.textContent = `Gerencie as atividades de ${formatDateForHuman(state.selectedDate)}.`;
}

function renderCalendar() {
  const { year, month } = parseMonthKey(state.visibleMonth);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = getTodayBrasiliaISO();
  const counts = createActivityCountByDate();
  const fragment = document.createDocumentFragment();

  elements.calendarGrid.innerHTML = "";
  elements.calendarMonthLabel.textContent = formatMonthLabel(state.visibleMonth);

  for (let index = 0; index < firstWeekday; index += 1) {
    const spacer = document.createElement("span");
    spacer.className = "calendar-day calendar-day--empty";
    spacer.setAttribute("aria-hidden", "true");
    fragment.appendChild(spacer);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const activityCount = counts.get(dateString) || 0;
    const locked = isDateLocked(dateString);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.dataset.date = dateString;
    button.setAttribute("aria-pressed", String(dateString === state.selectedDate));
    button.setAttribute("aria-label", `${formatDateForHuman(dateString)}${activityCount ? `, ${activityCount} atividade(s)` : ""}${locked ? ", dia encerrado" : ""}`);
    button.classList.toggle("is-selected", dateString === state.selectedDate);
    button.classList.toggle("is-today", dateString === today);
    button.classList.toggle("has-activities", activityCount > 0);
    button.classList.toggle("is-locked", locked);
    button.innerHTML = `<span>${day}</span>${activityCount ? `<small>${activityCount}</small>` : ""}`;
    fragment.appendChild(button);
  }

  elements.calendarGrid.appendChild(fragment);
}
function renderActivities() {
  const filteredActivities = getFilteredActivities();
  elements.activityList.innerHTML = "";

  if (filteredActivities.length === 0) {
    updateEmptyState();
    return;
  }

  elements.emptyState.classList.remove("is-visible");
  const fragment = document.createDocumentFragment();
  filteredActivities.forEach((activity) => fragment.appendChild(createActivityCard(activity)));
  elements.activityList.appendChild(fragment);
}

function createActivityCard(activity) {
  const card = document.createElement("article");
  const completed = activity.status === "completed";
  const locked = isDateLocked(activity.date);
  const disabledAttributes = locked ? "disabled aria-disabled=\"true\" title=\"Este dia já foi encerrado\"" : "";
  card.className = `activity-card ${completed ? "is-completed" : ""} ${locked ? "is-locked" : ""}`;
  card.dataset.activityId = activity.id;
  card.innerHTML = `
    <div class="activity-card__top">
      <div>
        <h3 class="activity-card__title">${escapeHTML(activity.name)}</h3>
        <div class="activity-card__meta">
          <span class="meta-pill" title="Data da atividade">${formatDateForHuman(activity.date)}</span>
          <span class="meta-pill" title="Duração planejada">${formatDuration(activity.duration, activity.unit)}</span>
          <span class="status-pill ${completed ? "status-pill--completed" : "status-pill--pending"}">${statusMap[activity.status]}</span>
          ${locked ? `<span class="status-pill status-pill--locked">Encerrado</span>` : ""}
        </div>
      </div>
    </div>
    <div class="activity-card__actions" aria-label="Ações da atividade ${escapeHTML(activity.name)}">
      <button class="action-btn action-btn--done" type="button" data-action="toggle" ${disabledAttributes}>${completed ? "Reabrir" : "Concluir"}</button>
      <button class="action-btn action-btn--edit" type="button" data-action="edit" ${disabledAttributes}>Editar</button>
      <button class="action-btn action-btn--delete" type="button" data-action="delete" ${disabledAttributes}>Excluir</button>
    </div>`;
  return card;
}

function getFilteredActivities() {
  const filterRules = {
    all: () => true,
    pending: (activity) => activity.status === "pending",
    completed: (activity) => activity.status === "completed",
  };
  return getActivitiesByDate(state.selectedDate).filter(filterRules[state.currentFilter] || filterRules.all);
}

function getActivitiesByDate(dateString) {
  return state.activities.filter((activity) => activity.date === dateString);
}

function updateActiveFilter() {
  elements.filterButtons.forEach((button) => {
    const active = button.dataset.filter === state.currentFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateEmptyState() {
  const messages = {
    all: ["Nenhuma atividade nesta data", "Adicione uma atividade para o dia selecionado."],
    pending: ["Nenhuma atividade pendente", "As pendentes desta data aparecerão aqui."],
    completed: ["Nenhuma atividade concluída", "As concluídas desta data aparecerão aqui."],
  };
  const [title, description] = messages[state.currentFilter] || messages.all;
  elements.emptyState.querySelector("h3").textContent = title;
  elements.emptyState.querySelector("p").textContent = description;
  elements.emptyState.classList.add("is-visible");
}

function syncFormAvailability() {
  const date = elements.dateInput.value || state.selectedDate;
  const locked = isValidISODate(date) && isDateLocked(date);
  elements.submitButton.disabled = locked;
  elements.submitButton.title = locked ? "Este dia já foi encerrado" : "";

  if (locked && !state.editingId) {
    showFormFeedback("Este dia já foi encerrado. Escolha outra data para cadastrar.", "error");
  } else if (!state.editingId) {
    clearFormFeedback();
  }
}

function canChangeActivity(activity) {
  if (!isDateLocked(activity.date)) return true;
  showLockedToast();
  resetFormMode();
  return false;
}

async function shareSelectedDayActivities() {
  const text = buildShareTextForSelectedDay();
  const title = `Atividades de ${formatDateForShare(state.selectedDate)}`;

  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      showToast({ title: "Atividades compartilhadas com sucesso", message: "O resumo do dia foi enviado pelo compartilhamento do navegador.", type: "success" });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.warn("Falha ao usar Web Share API. Tentando copiar texto.", error);
  }

  try {
    await copyText(text);
    showToast({ title: "Texto copiado para a área de transferência", message: "Cole onde quiser compartilhar suas atividades.", type: "success" });
  } catch (error) {
    console.error("Erro ao copiar texto:", error);
    showToast({ title: "Não foi possível compartilhar", message: "Seu navegador bloqueou o compartilhamento e a cópia automática.", type: "error" });
  }
}

function buildShareTextForSelectedDay() {
  const activities = getActivitiesByDate(state.selectedDate);
  const completed = activities.filter((activity) => activity.status === "completed").length;
  const pending = activities.length - completed;
  const lines = activities.length
    ? activities.map((activity, index) => `${index + 1}. ${activity.name} — ${formatDuration(activity.duration, activity.unit)} — ${statusMap[activity.status]}`)
    : ["Nenhuma atividade cadastrada para esta data."];

  return [
    `Minhas atividades de ${formatDateForShare(state.selectedDate)}`,
    "",
    "Resumo:",
    `Total: ${activities.length} atividade${activities.length === 1 ? "" : "s"}`,
    `Pendentes: ${pending}`,
    `Concluídas: ${completed}`,
    `Tempo planejado: ${formatTotalTime(sumDurationMinutes(activities))}`,
    "",
    "Atividades:",
    ...lines,
  ].join("\n");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Fallback de cópia falhou.");
}
function normalizeActivity(activity, index, fallbackDate) {
  if (!activity || typeof activity !== "object") return null;
  const duration = Number(activity.duration);
  const name = String(activity.name || `Atividade ${index + 1}`).trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name || Number.isNaN(duration) || duration <= 0) return null;
  return {
    id: activity.id || createId(),
    name,
    date: isValidISODate(activity.date) ? activity.date : fallbackDate,
    duration,
    unit: unitMap[activity.unit] ? activity.unit : "hours",
    status: activity.status === "completed" ? "completed" : "pending",
    createdAt: activity.createdAt || new Date().toISOString(),
    updatedAt: activity.updatedAt || new Date().toISOString(),
  };
}

function createActivityCountByDate() {
  const counts = new Map();
  state.activities.forEach((activity) => counts.set(activity.date, (counts.get(activity.date) || 0) + 1));
  return counts;
}

function findActivity(activityId) {
  return state.activities.find((activity) => activity.id === activityId);
}

function sumDurationMinutes(activities) {
  return activities.reduce((sum, activity) => sum + convertToMinutes(activity.duration, activity.unit), 0);
}

function convertToMinutes(duration, unit) {
  return Number(duration) * (unitMap[unit]?.minutesFactor || unitMap.hours.minutesFactor);
}

function formatDuration(duration, unit) {
  const unitData = unitMap[unit] || unitMap.hours;
  return `${formatNumber(duration)} ${Number(duration) === 1 ? unitData.singular : unitData.plural}`;
}

function formatTotalTime(totalMinutes) {
  if (!totalMinutes) return "0min";
  const rounded = Math.round(totalMinutes);
  const days = Math.floor(rounded / 1440);
  const hours = Math.floor((rounded % 1440) / 60);
  const minutes = rounded % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}min`);
  return parts.join(" ");
}

function formatNumber(value) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function formatDateForHuman(dateString, options = {}) {
  const { year, month, day } = parseISODate(dateString);
  const formatterOptions = { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" };
  if (options.includeWeekday) formatterOptions.weekday = "long";
  return new Intl.DateTimeFormat("pt-BR", formatterOptions).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatDateForShare(dateString) {
  return formatDateForHuman(dateString);
}

function formatMonthLabel(monthKey) {
  const { year, month } = parseMonthKey(monthKey);
  const label = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(year, month - 1, 1, 12)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getTodayBrasiliaISO() {
  const parts = getBrasiliaParts();
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getBrasiliaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRASILIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function isDateLocked(dateString, now = new Date()) {
  if (!isValidISODate(dateString)) return true;
  const { year, month, day } = parseISODate(dateString);
  const nowParts = getBrasiliaParts(now);
  const closeTimestamp = Date.UTC(year, month - 1, day + 1, 0, LOCK_MINUTES_AFTER_MIDNIGHT, 0);
  const currentTimestamp = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, nowParts.hour, nowParts.minute, nowParts.second);
  return currentTimestamp >= closeTimestamp;
}

function isValidISODate(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString))) return false;
  const { year, month, day } = parseISODate(dateString);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseISODate(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return { year, month, day };
}

function parseMonthKey(monthKey) {
  const [year, month] = String(monthKey).split("-").map(Number);
  return { year, month };
}

function getMonthKey(dateString) {
  return dateString.slice(0, 7);
}

function addDays(dateString, amount) {
  const { year, month, day } = parseISODate(dateString);
  return toISODate(new Date(Date.UTC(year, month - 1, day + amount)));
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setCounterValue(element, value) {
  if (element.textContent === String(value)) return;
  element.textContent = value;
  element.classList.remove("count-bump");
  requestAnimationFrame(() => element.classList.add("count-bump"));
}

function showFormFeedback(message, type = "error") {
  elements.formFeedback.textContent = message;
  elements.formFeedback.className = `form-feedback is-visible is-${type}`;
}

function clearFormFeedback() {
  elements.formFeedback.textContent = "";
  elements.formFeedback.className = "form-feedback";
}

function showLockedToast() {
  showToast({
    title: "Dia encerrado",
    message: "Este dia já foi encerrado. Você pode visualizar as atividades, mas não pode alterá-las.",
    type: "info",
  });
}

function showToast({ title, message, type = "success", duration = 3400 }) {
  if (!elements.toastContainer) return;
  const toast = document.createElement("div");
  const iconMap = { success: "OK", error: "!", info: "i" };
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "status");
  toast.innerHTML = `<span class="toast__icon" aria-hidden="true">${iconMap[type] || iconMap.info}</span><div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p></div>`;
  elements.toastContainer.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, duration);
}

function initRevealAnimations() {
  const revealElements = document.querySelectorAll(".reveal");
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          currentObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });
    revealElements.forEach((element) => observer.observe(element));
    return;
  }
  revealElements.forEach((element) => element.classList.add("is-visible"));
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

window.isDateLocked = isDateLocked;

const DAY_SETTINGS_KEY = "activity-flow.day-settings.v1";
const AI_SUGGESTIONS_KEY = "activity-flow.ai-suggestions.v1";

state.daySettings = {};
state.aiSuggestions = {};

Object.assign(elements, {
  daySettingsForm: document.querySelector("#daySettingsForm"),
  availableHoursInput: document.querySelector("#availableHours"),
  availableMinutesInput: document.querySelector("#availableMinutes"),
  startTimeInput: document.querySelector("#startTime"),
  endTimeInput: document.querySelector("#endTime"),
  breakTimeInput: document.querySelector("#breakTime"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  generateScheduleButton: document.querySelector("#generateScheduleButton"),
  generateSuggestionButton: document.querySelector("#generateSuggestionButton"),
  scheduleWarning: document.querySelector("#scheduleWarning"),
  scheduleList: document.querySelector("#scheduleList"),
  aiSuggestionCard: document.querySelector("#aiSuggestionCard"),
  aiSuggestionText: document.querySelector("#aiSuggestionText"),
  applySuggestionButton: document.querySelector("#applySuggestionButton"),
});

const daySettingsRepository = {
  async getAll() {
    try {
      const rawData = localStorage.getItem(DAY_SETTINGS_KEY);
      const parsedData = rawData ? JSON.parse(rawData) : {};
      return parsedData && typeof parsedData === "object" && !Array.isArray(parsedData) ? parsedData : {};
    } catch (error) {
      console.error("Erro ao carregar planejamento do dia:", error);
      return {};
    }
  },
  async saveAll(settings) {
    try {
      localStorage.setItem(DAY_SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (error) {
      console.error("Erro ao salvar planejamento do dia:", error);
      showToast({ title: "Erro ao salvar planejamento", message: "Não foi possível gravar o tempo disponível.", type: "error" });
      return false;
    }
  },
};

const aiSuggestionRepository = {
  async getAll() {
    try {
      const rawData = localStorage.getItem(AI_SUGGESTIONS_KEY);
      const parsedData = rawData ? JSON.parse(rawData) : {};
      return parsedData && typeof parsedData === "object" && !Array.isArray(parsedData) ? parsedData : {};
    } catch (error) {
      console.error("Erro ao carregar sugestões inteligentes:", error);
      return {};
    }
  },
  async saveAll(suggestions) {
    try {
      localStorage.setItem(AI_SUGGESTIONS_KEY, JSON.stringify(suggestions));
      return true;
    } catch (error) {
      console.error("Erro ao salvar sugestões inteligentes:", error);
      return false;
    }
  },
};

const aiService = {
  generateLocalSuggestion(dayActivities, daySettings, history) {
    const availableTime = daySettings.availableTime || 0;
    const breakTime = daySettings.breakTime || 0;
    const totalActivitiesTime = sumDurationMinutes(dayActivities);
    const totalBreakTime = Math.max(0, dayActivities.length - 1) * breakTime;
    const totalPlanned = totalActivitiesTime + totalBreakTime;
    const completedNames = history.completedNames;
    const pendingNames = history.pendingNames;
    const longestActivity = [...dayActivities].sort((a, b) => convertToMinutes(b.duration, b.unit) - convertToMinutes(a.duration, a.unit))[0];
    const orderedActivities = [...dayActivities].sort((a, b) => {
      const aCompletedBefore = completedNames.get(normalizeName(a.name)) || 0;
      const bCompletedBefore = completedNames.get(normalizeName(b.name)) || 0;
      if (aCompletedBefore !== bCompletedBefore) return bCompletedBefore - aCompletedBefore;
      return convertToMinutes(b.duration, b.unit) - convertToMinutes(a.duration, a.unit);
    });
    const messages = [];

    if (!dayActivities.length) {
      messages.push("Ainda não há atividades nesta data. Cadastre as tarefas principais antes de gerar uma agenda inteligente.");
    } else if (availableTime && totalPlanned > availableTime) {
      messages.push(`Seu dia está com ${formatTotalTime(totalPlanned)} planejados, mas você informou ${formatTotalTime(availableTime)} disponíveis. O excesso é de ${formatTotalTime(totalPlanned - availableTime)}.`);
      if (longestActivity) messages.push(`Recomendo mover "${longestActivity.name}" para amanhã ou reduzir sua duração hoje.`);
    } else if (availableTime) {
      messages.push(`O planejamento cabe no tempo disponível, com ${formatTotalTime(Math.max(availableTime - totalPlanned, 0))} de margem.`);
    } else {
      messages.push("Informe o tempo disponível do dia para a sugestão ficar mais precisa.");
    }

    if (dayActivities.length >= 4 && breakTime < 10) messages.push("Como há várias atividades, uma pausa de 10 minutos entre blocos pode deixar o dia mais sustentável.");
    if (longestActivity && convertToMinutes(longestActivity.duration, longestActivity.unit) >= 180) messages.push(`A atividade "${longestActivity.name}" é longa. Considere dividi-la em blocos menores.`);
    if (history.averagePlannedPerDay && totalActivitiesTime > history.averagePlannedPerDay * 1.25) messages.push("Este dia está acima da sua média de tempo planejado. Vale revisar prioridades antes de começar.");
    if (history.bestWeekday) messages.push(`Seu histórico indica melhor desempenho em ${history.bestWeekday}. Use esse padrão para posicionar tarefas importantes quando possível.`);

    const orderText = orderedActivities.map((activity, index) => `${index + 1}. ${activity.name}`).join("\n");
    if (orderText) messages.push(`Sugestão de ordem:\n${orderText}`);

    return {
      text: messages.join("\n\n"),
      orderedIds: orderedActivities.map((activity) => activity.id),
      canApply: orderedActivities.length > 1,
      generatedAt: new Date().toISOString(),
    };
  },

  async generateRemoteSuggestion() {
    // Futuramente, conecte esta função a um backend/API segura para chamar OpenAI, Gemini ou outra IA.
    // Não coloque chaves de API no front-end: elas devem ficar protegidas no servidor.
    throw new Error("IA remota ainda não configurada.");
  },
};
async function initApp() {
  const [activities, daySettings, aiSuggestions] = await Promise.all([
    activityRepository.getAll(),
    daySettingsRepository.getAll(),
    aiSuggestionRepository.getAll(),
  ]);
  state.activities = activities;
  state.daySettings = daySettings;
  state.aiSuggestions = aiSuggestions;
  elements.dateInput.value = state.selectedDate;
  bindEvents();
  initRevealAnimations();
  renderApp();
  showToast({ title: "Sistema carregado", message: "Suas atividades foram sincronizadas com este navegador.", type: "info", duration: 2600 });
}

function bindEvents() {
  elements.form.addEventListener("submit", handleFormSubmit);
  elements.cancelEditButton.addEventListener("click", resetFormMode);
  elements.activityList.addEventListener("click", handleActivityAction);
  elements.calendarGrid.addEventListener("click", handleCalendarClick);
  elements.previousMonthButton.addEventListener("click", () => changeVisibleMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => changeVisibleMonth(1));
  elements.previousDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, -1)));
  elements.nextDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, 1)));
  elements.todayButton.addEventListener("click", () => selectDate(getTodayBrasiliaISO()));
  elements.shareDayButton.addEventListener("click", shareSelectedDayActivities);
  elements.daySettingsForm.addEventListener("submit", saveSelectedDaySettings);
  elements.generateScheduleButton.addEventListener("click", generateScheduleForSelectedDay);
  elements.generateSuggestionButton.addEventListener("click", generateSuggestionForSelectedDay);
  elements.applySuggestionButton.addEventListener("click", applySuggestionForSelectedDay);

  elements.dateInput.addEventListener("change", () => {
    if (isValidISODate(elements.dateInput.value) && !state.editingId) selectDate(elements.dateInput.value);
    else syncFormAvailability();
  });

  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentFilter = button.dataset.filter;
      updateActiveFilter();
      renderActivities();
    });
  });
}

function renderApp() {
  renderSummary();
  renderSelectedDateHeader();
  renderDaySummary();
  renderCalendar();
  renderPlanningPanel();
  updateActiveFilter();
  renderActivities();
  syncFormAvailability();
}

async function saveSelectedDaySettings(event) {
  event.preventDefault();
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }
  const settings = readSettingsForm();
  const validation = validateDaySettings(settings);
  if (!validation.isValid) {
    showToast({ title: "Planejamento inválido", message: validation.message, type: "error" });
    return;
  }
  state.daySettings[state.selectedDate] = settings;
  if (!(await daySettingsRepository.saveAll(state.daySettings))) return;
  renderPlanningPanel();
  showToast({ title: "Planejamento salvo", message: "O tempo disponível do dia foi atualizado.", type: "success" });
}

function readSettingsForm() {
  const hours = Number(elements.availableHoursInput.value || 0);
  const minutes = Number(elements.availableMinutesInput.value || 0);
  return {
    date: state.selectedDate,
    availableTime: hours * 60 + minutes,
    startTime: elements.startTimeInput.value,
    endTime: elements.endTimeInput.value,
    breakTime: Number(elements.breakTimeInput.value || 0),
  };
}

function validateDaySettings(settings) {
  if (settings.availableTime < 0 || settings.availableTime > 1440) return { isValid: false, message: "Informe um tempo disponível entre 0 e 24 horas." };
  if (settings.breakTime < 0 || settings.breakTime > 120) return { isValid: false, message: "A pausa deve ficar entre 0 e 120 minutos." };
  if (settings.startTime && settings.endTime && parseTime(settings.endTime) <= parseTime(settings.startTime)) {
    return { isValid: false, message: "O horário final precisa ser maior que o horário inicial." };
  }
  return { isValid: true, message: "" };
}

function renderPlanningPanel() {
  const settings = getSettingsForDate(state.selectedDate);
  const locked = isDateLocked(state.selectedDate);
  const hours = Math.floor((settings.availableTime || 0) / 60);
  const minutes = (settings.availableTime || 0) % 60;
  elements.availableHoursInput.value = hours || "";
  elements.availableMinutesInput.value = minutes || "";
  elements.startTimeInput.value = settings.startTime || "";
  elements.endTimeInput.value = settings.endTime || "";
  elements.breakTimeInput.value = settings.breakTime || "";
  elements.saveSettingsButton.disabled = locked;
  elements.generateScheduleButton.disabled = locked;
  elements.generateSuggestionButton.disabled = locked;
  elements.applySuggestionButton.disabled = locked;
  renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
  renderAiSuggestion();
}

function generateScheduleForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }
  const settings = getSettingsForDate(state.selectedDate);
  renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
  showToast({ title: "Agenda gerada", message: "A distribuição do dia foi atualizada com base no tempo disponível.", type: "success" });
}

async function generateSuggestionForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }
  const suggestion = aiService.generateLocalSuggestion(getActivitiesByDate(state.selectedDate), getSettingsForDate(state.selectedDate), buildHistoryStats());
  state.aiSuggestions[state.selectedDate] = suggestion;
  await aiSuggestionRepository.saveAll(state.aiSuggestions);
  renderAiSuggestion();
  showToast({ title: "Sugestão gerada", message: "A IA local analisou seu planejamento do dia.", type: "success" });
}

async function applySuggestionForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }
  const suggestion = state.aiSuggestions[state.selectedDate];
  if (!suggestion?.orderedIds?.length) return;
  const order = new Map(suggestion.orderedIds.map((id, index) => [id, index]));
  const selected = state.activities.filter((activity) => activity.date === state.selectedDate).sort((a, b) => order.get(a.id) - order.get(b.id));
  const others = state.activities.filter((activity) => activity.date !== state.selectedDate);
  state.activities = [...selected, ...others];
  if (!(await activityRepository.saveAll(state.activities))) return;
  renderApp();
  showToast({ title: "Sugestão aplicada", message: "A ordem das atividades do dia foi reorganizada.", type: "success" });
}
function getSettingsForDate(dateString) {
  const saved = state.daySettings[dateString];
  return saved || { date: dateString, availableTime: 0, startTime: "08:00", endTime: "", breakTime: 10 };
}

function generateSchedule(activities, settings) {
  const start = parseTime(settings.startTime || "08:00");
  const breakTime = Math.max(0, Number(settings.breakTime || 0));
  const availableTime = Number(settings.availableTime || 0);
  const endLimit = settings.endTime ? parseTime(settings.endTime) : null;
  let cursor = start;
  const items = [];

  activities.forEach((activity, index) => {
    const duration = Math.round(convertToMinutes(activity.duration, activity.unit));
    const activityStart = cursor;
    const activityEnd = activityStart + duration;
    items.push({ type: "activity", name: activity.name, start: activityStart, end: activityEnd, status: activity.status });
    cursor = activityEnd;
    if (index < activities.length - 1 && breakTime > 0) {
      items.push({ type: "break", name: "Pausa", start: cursor, end: cursor + breakTime, status: "break" });
      cursor += breakTime;
    }
  });

  const totalActivities = sumDurationMinutes(activities);
  const totalBreaks = Math.max(0, activities.length - 1) * breakTime;
  const totalRequired = totalActivities + totalBreaks;
  const overAvailable = availableTime ? Math.max(totalRequired - availableTime, 0) : 0;
  const overEnd = endLimit ? Math.max(cursor - endLimit, 0) : 0;
  return { items, totalActivities, totalBreaks, totalRequired, availableTime, overAvailable, overEnd };
}

function renderSchedule(schedule) {
  elements.scheduleWarning.textContent = "";
  elements.scheduleWarning.classList.remove("is-visible");
  elements.scheduleList.innerHTML = "";

  if (!schedule.items.length) {
    elements.scheduleList.innerHTML = `<div class="schedule-empty">Nenhuma atividade para distribuir nesta data.</div>`;
    return;
  }

  if (schedule.overAvailable || schedule.overEnd) {
    const excess = Math.max(schedule.overAvailable, schedule.overEnd);
    elements.scheduleWarning.textContent = `As atividades deste dia ultrapassam o tempo disponível em ${formatTotalTime(excess)}. Considere remover uma atividade, diminuir a duração ou aumentar o tempo disponível.`;
    elements.scheduleWarning.classList.add("is-visible");
  }

  const fragment = document.createDocumentFragment();
  schedule.items.forEach((item) => {
    const row = document.createElement("div");
    row.className = `schedule-item schedule-item--${item.type}`;
    row.innerHTML = `<strong>${formatClock(item.start)} - ${formatClock(item.end)}</strong><span>${escapeHTML(item.name)}</span>${item.status === "completed" ? "<small>Concluída</small>" : ""}`;
    fragment.appendChild(row);
  });
  elements.scheduleList.appendChild(fragment);
}

function renderAiSuggestion() {
  const suggestion = state.aiSuggestions[state.selectedDate];
  if (!suggestion) {
    elements.aiSuggestionCard.classList.add("is-hidden");
    elements.aiSuggestionText.textContent = "";
    elements.applySuggestionButton.classList.add("is-hidden");
    return;
  }
  elements.aiSuggestionCard.classList.remove("is-hidden");
  elements.aiSuggestionText.textContent = suggestion.text;
  elements.applySuggestionButton.classList.toggle("is-hidden", !suggestion.canApply);
}

function buildHistoryStats() {
  const byDate = new Map();
  const completedNames = new Map();
  const pendingNames = new Map();
  state.activities.forEach((activity) => {
    byDate.set(activity.date, [...(byDate.get(activity.date) || []), activity]);
    const key = normalizeName(activity.name);
    const target = activity.status === "completed" ? completedNames : pendingNames;
    target.set(key, (target.get(key) || 0) + 1);
  });

  const totals = [...byDate.values()].map((activities) => sumDurationMinutes(activities));
  const averagePlannedPerDay = totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : 0;
  const weekdayScores = new Map();
  byDate.forEach((activities, date) => {
    const completed = activities.filter((activity) => activity.status === "completed").length;
    const score = completed / Math.max(activities.length, 1);
    const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(toUTCDate(date));
    weekdayScores.set(weekday, (weekdayScores.get(weekday) || 0) + score);
  });
  const bestWeekday = [...weekdayScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return { averagePlannedPerDay, completedNames, pendingNames, bestWeekday };
}

function normalizeName(name) {
  return String(name).trim().toLowerCase();
}

function parseTime(timeString) {
  const [hours, minutes] = String(timeString || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function formatClock(totalMinutes) {
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(minutesInDay / 60);
  const minutes = minutesInDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function toUTCDate(dateString) {
  const { year, month, day } = parseISODate(dateString);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function buildShareTextForSelectedDay() {
  const activities = getActivitiesByDate(state.selectedDate);
  const settings = getSettingsForDate(state.selectedDate);
  const schedule = generateSchedule(activities, settings);
  const suggestion = state.aiSuggestions[state.selectedDate];
  const completed = activities.filter((activity) => activity.status === "completed").length;
  const pending = activities.length - completed;
  const activityLines = activities.length
    ? activities.map((activity, index) => `${index + 1}. ${activity.name} — ${formatDuration(activity.duration, activity.unit)} — ${statusMap[activity.status]}`)
    : ["Nenhuma atividade cadastrada para esta data."];
  const scheduleLines = schedule.items.length
    ? schedule.items.map((item) => `${formatClock(item.start)} - ${formatClock(item.end)} | ${item.name}`)
    : ["Agenda ainda não gerada por falta de atividades."];

  return [
    `Minhas atividades de ${formatDateForShare(state.selectedDate)}`,
    "",
    "Resumo:",
    `Total: ${activities.length} atividade${activities.length === 1 ? "" : "s"}`,
    `Pendentes: ${pending}`,
    `Concluídas: ${completed}`,
    `Tempo planejado: ${formatTotalTime(sumDurationMinutes(activities))}`,
    `Tempo disponível: ${settings.availableTime ? formatTotalTime(settings.availableTime) : "não informado"}`,
    settings.startTime ? `Início: ${settings.startTime}` : "",
    settings.endTime ? `Fim: ${settings.endTime}` : "",
    `Pausa entre atividades: ${settings.breakTime || 0}min`,
    "",
    "Atividades:",
    ...activityLines,
    "",
    "Agenda sugerida:",
    ...scheduleLines,
    suggestion ? "" : null,
    suggestion ? "Sugestão inteligente:" : null,
    suggestion ? suggestion.text : null,
  ].filter((line) => line !== null && line !== "").join("\n");
}

function bindEvents() {
  elements.form.addEventListener("submit", handleFormSubmit);
  elements.cancelEditButton.addEventListener("click", resetFormMode);
  elements.activityList.addEventListener("click", handleActivityAction);
  elements.calendarGrid.addEventListener("click", handleCalendarClick);
  elements.previousMonthButton.addEventListener("click", () => changeVisibleMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => changeVisibleMonth(1));
  elements.previousDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, -1)));
  elements.nextDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, 1)));
  elements.todayButton.addEventListener("click", () => selectDate(getTodayBrasiliaISO()));
  elements.shareDayButton.addEventListener("click", shareSelectedDayActivities);
  elements.daySettingsForm.addEventListener("submit", saveSelectedDaySettings);
  elements.generateScheduleButton.addEventListener("click", generateScheduleForSelectedDay);
  elements.generateSuggestionButton.addEventListener("click", generateSuggestionForSelectedDay);
  elements.applySuggestionButton.addEventListener("click", applySuggestionForSelectedDay);
  elements.dateInput.addEventListener("change", () => {
    if (isValidISODate(elements.dateInput.value) && !state.editingId) selectDate(elements.dateInput.value);
    else syncFormAvailability();
  });
  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentFilter = button.dataset.filter;
      updateActiveFilter();
      renderActivities();
    });
  });
  window.addEventListener("storage", async (event) => {
    if ([STORAGE_KEY, DAY_SETTINGS_KEY, AI_SUGGESTIONS_KEY].includes(event.key)) {
      state.activities = await activityRepository.getAll();
      state.daySettings = await daySettingsRepository.getAll();
      state.aiSuggestions = await aiSuggestionRepository.getAll();
      renderApp();
    }
  });
}

async function generateScheduleForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }
  const settings = readSettingsForm();
  const validation = validateDaySettings(settings);
  if (!validation.isValid) {
    showToast({ title: "Planejamento inválido", message: validation.message, type: "error" });
    return;
  }
  state.daySettings[state.selectedDate] = settings;
  await daySettingsRepository.saveAll(state.daySettings);
  renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
  showToast({ title: "Agenda gerada", message: "A distribuição do dia foi atualizada com base no tempo disponível.", type: "success" });
}

Object.assign(elements, {
  dayTimeStatusCard: document.querySelector("#dayTimeStatusCard"),
  statusAvailableTime: document.querySelector("#statusAvailableTime"),
  statusPlannedTime: document.querySelector("#statusPlannedTime"),
  statusBalanceLabel: document.querySelector("#statusBalanceLabel"),
  statusBalanceTime: document.querySelector("#statusBalanceTime"),
  statusMessage: document.querySelector("#statusMessage"),
  shareWhatsAppButton: document.querySelector("#shareWhatsAppButton"),
  shareInstagramButton: document.querySelector("#shareInstagramButton"),
  copySummaryButton: document.querySelector("#copySummaryButton"),
  nativeShareButton: document.querySelector("#nativeShareButton"),
  instagramShareCard: document.querySelector("#instagramShareCard"),
  instagramCardDate: document.querySelector("#instagramCardDate"),
  instagramCardAvailable: document.querySelector("#instagramCardAvailable"),
  instagramCardPlanned: document.querySelector("#instagramCardPlanned"),
  instagramCardBalance: document.querySelector("#instagramCardBalance"),
  instagramCardTotal: document.querySelector("#instagramCardTotal"),
  instagramCardActivities: document.querySelector("#instagramCardActivities"),
  instagramCardStatus: document.querySelector("#instagramCardStatus"),
});

function calculateActivitiesTotal(activities) {
  return activities.reduce((total, activity) => total + convertToMinutes(activity.duration, activity.unit), 0);
}

function formatMinutes(minutes) {
  return formatTotalTime(Math.max(0, Math.round(Number(minutes) || 0)));
}

function getDayTimeStatus(dayActivities, daySettings) {
  const availableMinutes = Number(daySettings?.availableTime || 0);
  const plannedMinutes = calculateActivitiesTotal(dayActivities);
  const difference = availableMinutes - plannedMinutes;

  if (!availableMinutes) {
    return {
      status: "available",
      availableMinutes,
      plannedMinutes,
      remainingMinutes: 0,
      excessMinutes: 0,
      message: "Informe o tempo disponível para validar o limite deste dia.",
    };
  }

  if (difference < 0) {
    return {
      status: "error",
      availableMinutes,
      plannedMinutes,
      remainingMinutes: 0,
      excessMinutes: Math.abs(difference),
      message: `Erro: o tempo total das atividades ultrapassa o tempo disponível para este dia. Você ultrapassou o limite em ${formatMinutes(Math.abs(difference))}.`,
    };
  }

  if (difference === 0) {
    return {
      status: "limit",
      availableMinutes,
      plannedMinutes,
      remainingMinutes: 0,
      excessMinutes: 0,
      message: "Atenção: você atingiu exatamente o limite de tempo disponível para este dia.",
    };
  }

  return {
    status: "available",
    availableMinutes,
    plannedMinutes,
    remainingMinutes: difference,
    excessMinutes: 0,
    message: `Você ainda tem ${formatMinutes(difference)} disponíveis neste dia.`,
  };
}

function validateActivityAgainstDayLimit(activityData, selectedDate, editingId = null) {
  const targetDate = activityData.date || selectedDate;
  const candidateActivity = {
    id: editingId || "candidate",
    name: activityData.name || "Nova atividade",
    date: targetDate,
    duration: Number(activityData.duration),
    unit: activityData.unit,
    status: activityData.status || "pending",
  };
  const dayActivities = state.activities
    .filter((activity) => activity.date === targetDate && activity.id !== editingId)
    .concat(candidateActivity);
  const status = getDayTimeStatus(dayActivities, getSettingsForDate(targetDate));

  return {
    isValid: status.status !== "error",
    ...status,
  };
}

function validateCurrentDayWithinLimit() {
  const status = getDayTimeStatus(getActivitiesByDate(state.selectedDate), getSettingsForDate(state.selectedDate));
  if (status.status === "error") {
    showToast({ title: "Tempo ultrapassado", message: status.message, type: "error" });
    return false;
  }
  if (status.status === "limit") {
    showToast({ title: "No limite", message: status.message, type: "info" });
  }
  return true;
}

function getActivityPreviewStatus() {
  const data = getSanitizedFormData();
  if (!data.date || !data.duration || !data.unit || !isValidISODate(data.date) || Number(data.duration) <= 0) {
    return null;
  }
  return validateActivityAgainstDayLimit(data, data.date, state.editingId);
}

function updateRealtimeActivityFeedback() {
  if (state.editingId && !findActivity(state.editingId)) return;
  const locked = isValidISODate(elements.dateInput.value) && isDateLocked(elements.dateInput.value);
  const preview = getActivityPreviewStatus();

  if (locked) {
    elements.submitButton.disabled = true;
    showFormFeedback("Este dia já foi encerrado. Você pode visualizar as atividades, mas não pode alterá-las.", "error");
    return;
  }

  if (!preview) {
    elements.submitButton.disabled = false;
    if (!state.editingId) clearFormFeedback();
    return;
  }

  elements.submitButton.disabled = !preview.isValid;

  if (preview.status === "error") {
    showFormFeedback(`Essa atividade ultrapassa o tempo disponível em ${formatMinutes(preview.excessMinutes)}.`, "error");
  } else if (preview.status === "limit") {
    showFormFeedback("Essa atividade deixará seu dia exatamente no limite.", "warning");
  } else if (preview.availableMinutes) {
    showFormFeedback(`Essa atividade cabe no seu dia. Restarão ${formatMinutes(preview.remainingMinutes)}.`, "success");
  } else if (!state.editingId) {
    clearFormFeedback();
  }
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const formData = getSanitizedFormData();
  const validation = validateActivityData(formData);

  if (!validation.isValid) {
    showFormFeedback(validation.message, "error");
    return;
  }

  if (isDateLocked(formData.date)) {
    showLockedToast();
    showFormFeedback("Este dia já foi encerrado e não pode receber alterações.", "error");
    return;
  }

  const limitValidation = validateActivityAgainstDayLimit(formData, formData.date, state.editingId);
  if (!limitValidation.isValid) {
    showFormFeedback(limitValidation.message, "error");
    showToast({ title: "Tempo ultrapassado", message: limitValidation.message, type: "error" });
    return;
  }

  if (limitValidation.status === "limit") {
    showToast({ title: "No limite", message: limitValidation.message, type: "info" });
  }

  if (state.editingId) await updateActivity(state.editingId, formData);
  else await createActivity(formData);
}

async function updateActivity(activityId, data) {
  const activity = findActivity(activityId);
  if (!activity) {
    showToast({ title: "Atividade não encontrada", message: "Não foi possível editar esta atividade.", type: "error" });
    resetFormMode();
    return;
  }
  if (!canChangeActivity(activity) || isDateLocked(data.date)) return;

  const limitValidation = validateActivityAgainstDayLimit(data, data.date, activityId);
  if (!limitValidation.isValid) {
    showFormFeedback(limitValidation.message, "error");
    return;
  }

  const nextActivities = await activityRepository.update(activityId, {
    name: data.name,
    date: data.date,
    duration: data.duration,
    unit: data.unit,
  }, state.activities);
  if (!nextActivities) return;
  state.activities = nextActivities;
  selectDate(data.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({ title: "Atividade atualizada", message: "As alterações foram salvas com sucesso.", type: "success" });
}

function syncFormAvailability() {
  updateRealtimeActivityFeedback();
}

function bindEvents() {
  elements.form.addEventListener("submit", handleFormSubmit);
  elements.cancelEditButton.addEventListener("click", resetFormMode);
  elements.activityList.addEventListener("click", handleActivityAction);
  elements.calendarGrid.addEventListener("click", handleCalendarClick);
  elements.previousMonthButton.addEventListener("click", () => changeVisibleMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => changeVisibleMonth(1));
  elements.previousDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, -1)));
  elements.nextDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, 1)));
  elements.todayButton.addEventListener("click", () => selectDate(getTodayBrasiliaISO()));
  elements.shareWhatsAppButton.addEventListener("click", shareOnWhatsApp);
  elements.shareInstagramButton.addEventListener("click", shareOnInstagram);
  elements.copySummaryButton.addEventListener("click", copyShareText);
  elements.nativeShareButton.addEventListener("click", nativeShare);
  elements.daySettingsForm.addEventListener("submit", saveSelectedDaySettings);
  elements.generateScheduleButton.addEventListener("click", generateScheduleForSelectedDay);
  elements.generateSuggestionButton.addEventListener("click", generateSuggestionForSelectedDay);
  elements.applySuggestionButton.addEventListener("click", applySuggestionForSelectedDay);

  [elements.durationInput, elements.unitSelect, elements.dateInput, elements.nameInput].forEach((field) => {
    field.addEventListener("input", updateRealtimeActivityFeedback);
    field.addEventListener("change", updateRealtimeActivityFeedback);
  });

  [elements.availableHoursInput, elements.availableMinutesInput, elements.breakTimeInput, elements.startTimeInput, elements.endTimeInput].forEach((field) => {
    field.addEventListener("input", () => {
      renderTimeStatusCard(getDayTimeStatus(getActivitiesByDate(state.selectedDate), readSettingsForm()));
    });
  });

  elements.dateInput.addEventListener("change", () => {
    if (isValidISODate(elements.dateInput.value) && !state.editingId) selectDate(elements.dateInput.value);
  });

  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentFilter = button.dataset.filter;
      updateActiveFilter();
      renderActivities();
    });
  });

  window.addEventListener("storage", async (event) => {
    if ([STORAGE_KEY, DAY_SETTINGS_KEY, AI_SUGGESTIONS_KEY].includes(event.key)) {
      state.activities = await activityRepository.getAll();
      state.daySettings = await daySettingsRepository.getAll();
      state.aiSuggestions = await aiSuggestionRepository.getAll();
      renderApp();
    }
  });
}

function renderDaySummary() {
  const dayActivities = getActivitiesByDate(state.selectedDate);
  const total = dayActivities.length;
  const completed = dayActivities.filter((activity) => activity.status === "completed").length;
  const pending = total - completed;
  const timeStatus = getDayTimeStatus(dayActivities, getSettingsForDate(state.selectedDate));

  setCounterValue(elements.dayTotalActivities, total);
  setCounterValue(elements.dayPendingActivities, pending);
  setCounterValue(elements.dayCompletedActivities, completed);
  setCounterValue(elements.dayTotalTime, formatMinutes(timeStatus.plannedMinutes));
  elements.activityListDescription.textContent = `Gerencie as atividades de ${formatDateForHuman(state.selectedDate)}.`;
  renderTimeStatusCard(timeStatus);
  renderInstagramCard(timeStatus, dayActivities, completed, pending);
}

function renderTimeStatusCard(timeStatus) {
  if (!elements.dayTimeStatusCard) return;
  elements.dayTimeStatusCard.classList.remove("is-available", "is-limit", "is-error");
  elements.dayTimeStatusCard.classList.add(`is-${timeStatus.status}`);
  elements.statusAvailableTime.textContent = timeStatus.availableMinutes ? formatMinutes(timeStatus.availableMinutes) : "Não informado";
  elements.statusPlannedTime.textContent = formatMinutes(timeStatus.plannedMinutes);
  elements.statusBalanceLabel.textContent = timeStatus.status === "error" ? "Excesso" : "Restante";
  elements.statusBalanceTime.textContent = timeStatus.status === "error" ? formatMinutes(timeStatus.excessMinutes) : formatMinutes(timeStatus.remainingMinutes);
  elements.statusMessage.textContent = getReadableDayStatus(timeStatus);
}

function getReadableDayStatus(timeStatus) {
  if (!timeStatus.availableMinutes) return timeStatus.message;
  if (timeStatus.status === "error") return `Tempo ultrapassado: excesso de ${formatMinutes(timeStatus.excessMinutes)}.`;
  if (timeStatus.status === "limit") return "No limite do dia.";
  return `Ainda há tempo disponível: ${formatMinutes(timeStatus.remainingMinutes)} restantes.`;
}

function renderInstagramCard(timeStatus, activities, completed, pending) {
  if (!elements.instagramShareCard) return;
  elements.instagramCardDate.textContent = formatDateForHuman(state.selectedDate);
  elements.instagramCardAvailable.textContent = `Disponível: ${timeStatus.availableMinutes ? formatMinutes(timeStatus.availableMinutes) : "não informado"}`;
  elements.instagramCardPlanned.textContent = `Planejado: ${formatMinutes(timeStatus.plannedMinutes)}`;
  elements.instagramCardBalance.textContent = `${timeStatus.status === "error" ? "Excesso" : "Restante"}: ${timeStatus.status === "error" ? formatMinutes(timeStatus.excessMinutes) : formatMinutes(timeStatus.remainingMinutes)}`;
  elements.instagramCardTotal.textContent = `${activities.length} atividade${activities.length === 1 ? "" : "s"} | ${pending} pend. | ${completed} concl.`;
  elements.instagramCardActivities.innerHTML = "";
  activities.slice(0, 4).forEach((activity) => {
    const item = document.createElement("li");
    item.textContent = `${activity.name} · ${formatDuration(activity.duration, activity.unit)}`;
    elements.instagramCardActivities.appendChild(item);
  });
  if (!activities.length) {
    const item = document.createElement("li");
    item.textContent = "Nenhuma atividade cadastrada";
    elements.instagramCardActivities.appendChild(item);
  }
  elements.instagramCardStatus.textContent = getReadableDayStatus(timeStatus);
  elements.instagramShareCard.className = `instagram-share-card is-${timeStatus.status}`;
}

async function saveSelectedDaySettings(event) {
  event.preventDefault();
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }
  const settings = readSettingsForm();
  const validation = validateDaySettings(settings);
  if (!validation.isValid) {
    showToast({ title: "Planejamento inválido", message: validation.message, type: "error" });
    return;
  }
  const timeStatus = getDayTimeStatus(getActivitiesByDate(state.selectedDate), settings);
  if (timeStatus.status === "error") {
    showToast({ title: "Tempo ultrapassado", message: timeStatus.message, type: "error" });
    return;
  }
  state.daySettings[state.selectedDate] = settings;
  if (!(await daySettingsRepository.saveAll(state.daySettings))) return;
  renderApp();
  showToast({ title: "Planejamento salvo", message: timeStatus.status === "limit" ? timeStatus.message : "O tempo disponível do dia foi atualizado.", type: timeStatus.status === "limit" ? "info" : "success" });
}

async function generateScheduleForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }
  const settings = readSettingsForm();
  const validation = validateDaySettings(settings);
  if (!validation.isValid) {
    showToast({ title: "Planejamento inválido", message: validation.message, type: "error" });
    return;
  }
  const timeStatus = getDayTimeStatus(getActivitiesByDate(state.selectedDate), settings);
  if (timeStatus.status === "error") {
    showToast({ title: "Agenda não gerada", message: timeStatus.message, type: "error" });
    renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
    return;
  }
  state.daySettings[state.selectedDate] = settings;
  await daySettingsRepository.saveAll(state.daySettings);
  renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
  showToast({ title: "Agenda gerada", message: timeStatus.status === "limit" ? timeStatus.message : timeStatus.message, type: timeStatus.status === "limit" ? "info" : "success" });
}

async function generateSuggestionForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }
  if (!validateCurrentDayWithinLimit()) return;
  const suggestion = aiService.generateLocalSuggestion(getActivitiesByDate(state.selectedDate), getSettingsForDate(state.selectedDate), buildHistoryStats());
  state.aiSuggestions[state.selectedDate] = suggestion;
  await aiSuggestionRepository.saveAll(state.aiSuggestions);
  renderAiSuggestion();
  showToast({ title: "Sugestão gerada", message: "A IA local analisou seu planejamento do dia.", type: "success" });
}

async function applySuggestionForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }
  if (!validateCurrentDayWithinLimit()) return;
  const suggestion = state.aiSuggestions[state.selectedDate];
  if (!suggestion?.orderedIds?.length) return;
  const order = new Map(suggestion.orderedIds.map((id, index) => [id, index]));
  const selected = state.activities
    .filter((activity) => activity.date === state.selectedDate)
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  const others = state.activities.filter((activity) => activity.date !== state.selectedDate);
  state.activities = [...selected, ...others];
  if (!(await activityRepository.saveAll(state.activities))) return;
  renderApp();
  showToast({ title: "Sugestão aplicada", message: "A ordem das atividades do dia foi reorganizada.", type: "success" });
}

function generateDayShareText(selectedDate) {
  const activities = getActivitiesByDate(selectedDate);
  const settings = getSettingsForDate(selectedDate);
  const timeStatus = getDayTimeStatus(activities, settings);
  const schedule = generateSchedule(activities, settings);
  const suggestion = state.aiSuggestions[selectedDate];
  const completed = activities.filter((activity) => activity.status === "completed").length;
  const pending = activities.length - completed;
  const activityLines = activities.length
    ? activities.map((activity, index) => `${index + 1}. ${activity.name} — ${formatDuration(activity.duration, activity.unit)} — ${statusMap[activity.status]}`)
    : ["Nenhuma atividade cadastrada para esta data."];
  const scheduleLines = schedule.items.length
    ? schedule.items.map((item) => `${formatClock(item.start)} - ${formatClock(item.end)} | ${item.name}`)
    : [];
  const statusLine = timeStatus.status === "error"
    ? `O tempo planejado ultrapassou o limite em ${formatMinutes(timeStatus.excessMinutes)}.`
    : timeStatus.status === "limit"
      ? "O tempo planejado atingiu exatamente o limite disponível."
      : timeStatus.availableMinutes
        ? `Tempo restante: ${formatMinutes(timeStatus.remainingMinutes)}`
        : "Tempo disponível ainda não informado.";

  return [
    `Minhas atividades de ${formatDateForShare(selectedDate)}`,
    "",
    "Resumo do dia:",
    `Tempo disponível: ${timeStatus.availableMinutes ? formatMinutes(timeStatus.availableMinutes) : "não informado"}`,
    `Tempo planejado: ${formatMinutes(timeStatus.plannedMinutes)}`,
    statusLine,
    "",
    "Atividades:",
    ...activityLines,
    "",
    "Status:",
    `Total: ${activities.length}`,
    `Pendentes: ${pending}`,
    `Concluídas: ${completed}`,
    scheduleLines.length ? "" : null,
    scheduleLines.length ? "Agenda sugerida:" : null,
    ...scheduleLines,
    suggestion ? "" : null,
    suggestion ? "Sugestão inteligente:" : null,
    suggestion ? suggestion.text : null,
  ].filter((line) => line !== null).join("\n");
}

function buildShareTextForSelectedDay() {
  return generateDayShareText(state.selectedDate);
}

function shareSelectedDayActivities() {
  return nativeShare();
}

function shareOnWhatsApp() {
  const shareText = generateDayShareText(state.selectedDate);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  window.open(whatsappUrl, "_blank");
  showToast({ title: "WhatsApp aberto", message: "A mensagem do dia foi preparada para envio.", type: "success" });
}

async function shareOnInstagram() {
  const shareText = generateDayShareText(state.selectedDate);
  try {
    if (navigator.share) {
      await navigator.share({ title: "Minhas atividades do dia", text: shareText });
      showToast({ title: "Resumo compartilhado", message: "O compartilhamento do navegador foi acionado.", type: "success" });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.warn("Falha ao compartilhar para Instagram:", error);
  }
  await copyText(shareText);
  showToast({ title: "Resumo copiado", message: "Agora você pode colar no Instagram, Stories ou Direct.", type: "success" });
}

async function copyShareText() {
  await copyText(generateDayShareText(state.selectedDate));
  showToast({ title: "Resumo copiado", message: "Resumo copiado para a área de transferência.", type: "success" });
}

async function nativeShare() {
  const shareText = generateDayShareText(state.selectedDate);
  try {
    if (navigator.share) {
      await navigator.share({ title: "Minhas atividades do dia", text: shareText });
      showToast({ title: "Atividades compartilhadas", message: "O resumo do dia foi enviado pelo compartilhamento nativo.", type: "success" });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.warn("Falha no compartilhamento nativo:", error);
  }
  await copyText(shareText);
  showToast({ title: "Texto copiado", message: "Seu navegador não tem compartilhamento nativo, então o resumo foi copiado.", type: "success" });
}

function getDayAvailableTime(selectedDate) {
  const availableTime = Number(state.daySettings?.[selectedDate]?.availableTime || 0);
  return Number.isFinite(availableTime) ? availableTime : 0;
}

function canAddActivityToDay(newActivity, selectedDate, editingId = null) {
  const availableTime = getDayAvailableTime(selectedDate);

  if (!availableTime) {
    return {
      allowed: false,
      status: "error",
      availableTime,
      currentTotal: calculateActivitiesTotal(getActivitiesByDate(selectedDate)),
      newActivityTime: 0,
      finalTotal: calculateActivitiesTotal(getActivitiesByDate(selectedDate)),
      difference: 0,
      message: "Defina o tempo disponível deste dia antes de adicionar atividades.",
    };
  }

  const dayActivities = getActivitiesByDate(selectedDate);
  const activitiesWithoutEditingItem = editingId
    ? dayActivities.filter((activity) => activity.id !== editingId)
    : dayActivities;
  const currentTotal = calculateActivitiesTotal(activitiesWithoutEditingItem);
  const newActivityTime = convertToMinutes(newActivity.duration, newActivity.unit);
  const finalTotal = currentTotal + newActivityTime;
  const difference = finalTotal - availableTime;

  if (!Number.isFinite(newActivityTime) || newActivityTime < 0) {
    return {
      allowed: false,
      status: "error",
      availableTime,
      currentTotal,
      newActivityTime,
      finalTotal,
      difference: 0,
      message: "Informe uma duração válida para a atividade.",
    };
  }

  if (difference > 0) {
    return {
      allowed: false,
      status: "error",
      availableTime,
      currentTotal,
      newActivityTime,
      finalTotal,
      difference,
      message: `Não foi possível adicionar esta atividade. Ela ultrapassa o tempo disponível do dia em ${formatMinutes(difference)}.`,
    };
  }

  if (difference === 0) {
    return {
      allowed: true,
      status: "limit",
      availableTime,
      currentTotal,
      newActivityTime,
      finalTotal,
      difference,
      message: "Essa atividade cabe no seu dia, mas deixará o planejamento no limite.",
    };
  }

  return {
    allowed: true,
    status: "available",
    availableTime,
    currentTotal,
    newActivityTime,
    finalTotal,
    difference,
    message: `Essa atividade cabe no seu dia. Depois dela, ainda restará ${formatMinutes(Math.abs(difference))} disponível.`,
  };
}

function validateActivityAgainstDayLimit(activityData, selectedDate, editingId = null) {
  const result = canAddActivityToDay(activityData, activityData.date || selectedDate, editingId);
  return {
    isValid: result.allowed,
    availableMinutes: result.availableTime,
    plannedMinutes: result.finalTotal,
    remainingMinutes: result.allowed ? Math.max(result.availableTime - result.finalTotal, 0) : 0,
    excessMinutes: result.allowed ? 0 : Math.max(result.difference, 0),
    ...result,
  };
}

function validateCurrentDayWithinLimit() {
  const result = canAddActivityToDay({ duration: 0, unit: "minutes" }, state.selectedDate, null);

  if (!result.allowed) {
    showToast({ title: "Limite de tempo ultrapassado", message: result.message, type: "error" });
    return false;
  }

  if (result.status === "limit") {
    showToast({ title: "No limite", message: "O planejamento já está exatamente no limite do tempo disponível.", type: "info" });
  }

  return true;
}

function getActivityPreviewStatus() {
  const data = getSanitizedFormData();
  const selectedDate = data.date || state.selectedDate;

  if (!isValidISODate(selectedDate)) {
    return null;
  }

  if (!getDayAvailableTime(selectedDate)) {
    return canAddActivityToDay({ duration: 0, unit: "minutes" }, selectedDate, state.editingId);
  }

  if (!data.duration || !data.unit || Number(data.duration) <= 0) {
    return null;
  }

  return canAddActivityToDay(data, selectedDate, state.editingId);
}

function setActivityFormDisabled(disabled) {
  [elements.nameInput, elements.durationInput, elements.unitSelect, elements.submitButton].forEach((field) => {
    field.disabled = disabled;
  });
}

function updateRealtimeActivityFeedback() {
  if (state.editingId && !findActivity(state.editingId)) return;

  const selectedDate = elements.dateInput.value || state.selectedDate;
  const locked = isValidISODate(selectedDate) && isDateLocked(selectedDate);

  if (locked) {
    setActivityFormDisabled(true);
    showFormFeedback("Este dia já foi encerrado. Você pode visualizar as atividades, mas não pode alterá-las.", "error");
    return;
  }

  setActivityFormDisabled(false);

  if (!isValidISODate(selectedDate)) {
    elements.submitButton.disabled = true;
    showFormFeedback("Selecione uma data válida para cadastrar a atividade.", "error");
    return;
  }

  if (!getDayAvailableTime(selectedDate)) {
    elements.submitButton.disabled = true;
    showFormFeedback("Defina o tempo disponível deste dia antes de adicionar atividades.", "error");
    return;
  }

  const preview = getActivityPreviewStatus();

  if (!preview) {
    elements.submitButton.disabled = false;
    if (!state.editingId) clearFormFeedback();
    return;
  }

  elements.submitButton.disabled = !preview.allowed;

  if (!preview.allowed) {
    showFormFeedback(preview.message, "error");
    return;
  }

  if (preview.status === "limit") {
    showFormFeedback(preview.message, "warning");
    return;
  }

  showFormFeedback(preview.message, "success");
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const activityData = getSanitizedFormData();
  const validation = validateActivityData(activityData);

  if (!validation.isValid) {
    showFormFeedback(validation.message, "error");
    return;
  }

  if (isDateLocked(activityData.date)) {
    showLockedToast();
    showFormFeedback("Este dia já foi encerrado. Você pode visualizar as atividades, mas não pode alterá-las.", "error");
    return;
  }

  const limitValidation = canAddActivityToDay(activityData, activityData.date, state.editingId);

  if (!limitValidation.allowed) {
    showFormFeedback(limitValidation.message, "error");
    showToast({
      title: "Limite de tempo ultrapassado",
      message: limitValidation.message,
      type: "error",
    });
    return;
  }

  showFormFeedback(limitValidation.message, limitValidation.status === "limit" ? "warning" : "success");

  if (limitValidation.status === "limit") {
    showToast({ title: "Planejamento no limite", message: limitValidation.message, type: "info" });
  }

  if (state.editingId) {
    await updateActivity(state.editingId, activityData);
    return;
  }

  await createActivity(activityData);
}

async function updateActivity(activityId, data) {
  const activity = findActivity(activityId);

  if (!activity) {
    showToast({ title: "Atividade não encontrada", message: "Não foi possível editar esta atividade.", type: "error" });
    resetFormMode();
    return;
  }

  if (!canChangeActivity(activity) || isDateLocked(data.date)) {
    showLockedToast();
    return;
  }

  const limitValidation = canAddActivityToDay(data, data.date, activityId);

  if (!limitValidation.allowed) {
    showFormFeedback(limitValidation.message, "error");
    showToast({ title: "Limite de tempo ultrapassado", message: limitValidation.message, type: "error" });
    return;
  }

  const nextActivities = await activityRepository.update(activityId, {
    name: data.name,
    date: data.date,
    duration: data.duration,
    unit: data.unit,
  }, state.activities);

  if (!nextActivities) return;

  state.activities = nextActivities;
  selectDate(data.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({ title: "Atividade atualizada", message: "As alterações foram salvas com sucesso.", type: "success" });
}

function syncFormAvailability() {
  updateRealtimeActivityFeedback();
}

async function generateScheduleForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }

  const settings = readSettingsForm();
  const settingsValidation = validateDaySettings(settings);

  if (!settingsValidation.isValid) {
    showToast({ title: "Planejamento inválido", message: settingsValidation.message, type: "error" });
    return;
  }

  const previousSettings = state.daySettings[state.selectedDate];
  state.daySettings[state.selectedDate] = settings;
  const limitValidation = canAddActivityToDay({ duration: 0, unit: "minutes" }, state.selectedDate, null);

  if (!limitValidation.allowed) {
    if (previousSettings) state.daySettings[state.selectedDate] = previousSettings;
    else delete state.daySettings[state.selectedDate];
    renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
    showToast({ title: "Agenda não gerada", message: limitValidation.message, type: "error" });
    return;
  }

  if (!(await daySettingsRepository.saveAll(state.daySettings))) return;

  renderApp();
  renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
  showToast({
    title: "Agenda gerada",
    message: limitValidation.status === "limit" ? "O planejamento está exatamente no limite do dia." : "A distribuição do dia foi atualizada com base no tempo disponível.",
    type: limitValidation.status === "limit" ? "info" : "success",
  });
}

async function applySuggestionForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }

  const limitValidation = canAddActivityToDay({ duration: 0, unit: "minutes" }, state.selectedDate, null);

  if (!limitValidation.allowed) {
    showToast({ title: "Sugestão não aplicada", message: limitValidation.message, type: "error" });
    return;
  }

  const suggestion = state.aiSuggestions[state.selectedDate];
  if (!suggestion?.orderedIds?.length) return;

  const order = new Map(suggestion.orderedIds.map((id, index) => [id, index]));
  const selected = state.activities
    .filter((activity) => activity.date === state.selectedDate)
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  const others = state.activities.filter((activity) => activity.date !== state.selectedDate);

  state.activities = [...selected, ...others];

  if (!(await activityRepository.saveAll(state.activities))) return;

  renderApp();
  showToast({ title: "Sugestão aplicada", message: "A ordem das atividades do dia foi reorganizada.", type: "success" });
}

Object.assign(elements, {
  availableDurationInput: document.querySelector("#availableDuration"),
  statusActivitiesTime: document.querySelector("#statusActivitiesTime"),
  statusBreaksTime: document.querySelector("#statusBreaksTime"),
});

function parseDurationToMinutes(value) {
  const input = String(value ?? "").trim();

  if (!isValidDurationInput(input)) {
    return NaN;
  }

  if (input.includes(":")) {
    const [hours, minutes] = input.split(":").map(Number);
    return hours * 60 + minutes;
  }

  return Number(input) * 60;
}

function isValidDurationInput(value) {
  const input = String(value ?? "").trim();

  if (!input || input.includes(",") || input.includes(".")) return false;
  if (/^\d+$/.test(input)) return Number(input) > 0;
  if (!/^\d+:\d{2}$/.test(input)) return false;

  const [hours, minutes] = input.split(":").map(Number);
  return Number.isInteger(hours) && Number.isInteger(minutes) && minutes >= 0 && minutes <= 59 && hours * 60 + minutes > 0;
}

function formatMinutesToDuration(minutes) {
  return formatMinutes(minutes);
}

function getActivityMinutes(activity) {
  if (Number.isFinite(Number(activity?.durationMinutes))) {
    return Number(activity.durationMinutes);
  }

  return convertToMinutes(activity?.duration, activity?.unit);
}

function convertToMinutes(duration, unit) {
  const numericDuration = Number(duration);
  if (!Number.isFinite(numericDuration)) return 0;
  return numericDuration * (unitMap[unit]?.minutesFactor || unitMap.hours.minutesFactor);
}

function formatDuration(durationOrActivity, unit) {
  const minutes = typeof durationOrActivity === "object"
    ? getActivityMinutes(durationOrActivity)
    : unit === "minutes"
      ? Number(durationOrActivity)
      : convertToMinutes(durationOrActivity, unit);
  return formatMinutesToDuration(minutes);
}

function calculateActivitiesTotal(activities) {
  return activities.reduce((total, activity) => total + getActivityMinutes(activity), 0);
}

function calculateBreaksTotal(activitiesCount, breakMinutes) {
  if (activitiesCount <= 1) return 0;
  return (activitiesCount - 1) * Math.max(0, Number(breakMinutes || 0));
}

function normalizeActivity(activity, index, fallbackDate) {
  if (!activity || typeof activity !== "object") return null;

  const durationMinutes = Number.isFinite(Number(activity.durationMinutes))
    ? Number(activity.durationMinutes)
    : convertToMinutes(activity.duration, activity.unit);
  const name = String(activity.name || `Atividade ${index + 1}`).trim().replace(/\s+/g, " ").slice(0, 80);

  if (!name || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;

  return {
    id: activity.id || createId(),
    name,
    date: isValidISODate(activity.date) ? activity.date : fallbackDate,
    durationMinutes,
    status: activity.status === "completed" ? "completed" : "pending",
    createdAt: activity.createdAt || new Date().toISOString(),
    updatedAt: activity.updatedAt || new Date().toISOString(),
  };
}

function normalizeDaySettings(settings, dateString) {
  const availableMinutes = Number.isFinite(Number(settings?.availableMinutes))
    ? Number(settings.availableMinutes)
    : Number(settings?.availableTime || 0);
  const breakMinutes = Number.isFinite(Number(settings?.breakMinutes))
    ? Number(settings.breakMinutes)
    : Number(settings?.breakTime || 0);

  return {
    date: dateString,
    availableMinutes: Math.max(0, availableMinutes),
    startTime: settings?.startTime || "08:00",
    endTime: settings?.endTime || "",
    breakMinutes: Math.max(0, breakMinutes),
  };
}

function getSettingsForDate(dateString) {
  return normalizeDaySettings(state.daySettings?.[dateString], dateString);
}

function getDayAvailableTime(selectedDate) {
  return getSettingsForDate(selectedDate).availableMinutes;
}

function readSettingsForm() {
  return {
    date: state.selectedDate,
    availableMinutes: parseDurationToMinutes(elements.availableDurationInput?.value || ""),
    startTime: elements.startTimeInput.value,
    endTime: elements.endTimeInput.value,
    breakMinutes: elements.breakTimeInput.value === "" ? 0 : Number(elements.breakTimeInput.value),
  };
}

function validateDaySettings(settings) {
  if (!Number.isFinite(settings.availableMinutes) || settings.availableMinutes <= 0 || settings.availableMinutes > 1440) {
    return { isValid: false, message: "Informe o tempo disponível no formato correto, como 6:00 ou 0:45." };
  }

  if (!Number.isInteger(Number(settings.breakMinutes)) || Number(settings.breakMinutes) < 0 || Number(settings.breakMinutes) > 120) {
    return { isValid: false, message: "A pausa deve ser um número inteiro de minutos entre 0 e 120." };
  }

  if (settings.startTime && settings.endTime && parseTime(settings.endTime) <= parseTime(settings.startTime)) {
    return { isValid: false, message: "O horário final precisa ser maior que o horário inicial." };
  }

  return { isValid: true, message: "" };
}

function getDayTimeStatus(dayActivities, daySettings) {
  const settings = normalizeDaySettings(daySettings, state.selectedDate);
  const availableMinutes = settings.availableMinutes;
  const activitiesMinutes = calculateActivitiesTotal(dayActivities);
  const breaksMinutes = calculateBreaksTotal(dayActivities.length, settings.breakMinutes);
  const plannedMinutes = activitiesMinutes + breaksMinutes;
  const difference = availableMinutes - plannedMinutes;

  if (!availableMinutes) {
    return {
      status: "available",
      availableMinutes,
      activitiesMinutes,
      breaksMinutes,
      plannedMinutes,
      remainingMinutes: 0,
      excessMinutes: 0,
      message: "Informe o tempo disponível para validar o limite deste dia.",
    };
  }

  if (difference < 0) {
    return {
      status: "error",
      availableMinutes,
      activitiesMinutes,
      breaksMinutes,
      plannedMinutes,
      remainingMinutes: 0,
      excessMinutes: Math.abs(difference),
      message: `Erro: o tempo total das atividades e pausas ultrapassa o tempo disponível para este dia em ${formatMinutes(Math.abs(difference))}.`,
    };
  }

  if (difference === 0) {
    return {
      status: "limit",
      availableMinutes,
      activitiesMinutes,
      breaksMinutes,
      plannedMinutes,
      remainingMinutes: 0,
      excessMinutes: 0,
      message: "Atenção: você atingiu exatamente o limite de tempo disponível para este dia.",
    };
  }

  return {
    status: "available",
    availableMinutes,
    activitiesMinutes,
    breaksMinutes,
    plannedMinutes,
    remainingMinutes: difference,
    excessMinutes: 0,
    message: `Você ainda tem ${formatMinutes(difference)} disponíveis neste dia.`,
  };
}

function getSanitizedFormData() {
  return {
    name: elements.nameInput.value.trim().replace(/\s+/g, " "),
    date: elements.dateInput.value,
    durationInput: elements.durationInput.value.trim(),
    durationMinutes: parseDurationToMinutes(elements.durationInput.value),
    unit: "minutes",
  };
}

function validateActivityData(data) {
  if (!data.name || !data.date || !data.durationInput) {
    return { isValid: false, message: "Preencha o nome, a data e a duração da atividade." };
  }

  if (data.name.length < 2) {
    return { isValid: false, message: "O nome da atividade precisa ter pelo menos 2 caracteres." };
  }

  if (!isValidISODate(data.date)) {
    return { isValid: false, message: "Informe uma data válida no formato esperado." };
  }

  if (!isValidDurationInput(data.durationInput)) {
    return { isValid: false, message: "Informe a duração no formato correto, como 2:30, 0:45 ou 2. Não use vírgula ou ponto." };
  }

  if (!Number.isFinite(data.durationMinutes) || data.durationMinutes <= 0 || data.durationMinutes > 14400) {
    return { isValid: false, message: "A duração precisa ser maior que zero e dentro de um limite realista." };
  }

  return { isValid: true, message: "" };
}

function canAddActivityToDay(newActivity, selectedDate, editingId = null) {
  const settings = getSettingsForDate(selectedDate);
  const availableTime = settings.availableMinutes;
  const newActivityTime = Number.isFinite(Number(newActivity.durationMinutes))
    ? Number(newActivity.durationMinutes)
    : parseDurationToMinutes(newActivity.durationInput ?? newActivity.duration ?? "");

  if (!availableTime) {
    return {
      allowed: false,
      status: "error",
      availableTime,
      currentTotal: calculateActivitiesTotal(getActivitiesByDate(selectedDate)),
      newActivityTime: Number.isFinite(newActivityTime) ? newActivityTime : 0,
      finalTotal: calculateActivitiesTotal(getActivitiesByDate(selectedDate)),
      breaksMinutes: calculateBreaksTotal(getActivitiesByDate(selectedDate).length, settings.breakMinutes),
      difference: 0,
      message: "Defina o tempo disponível deste dia antes de adicionar atividades.",
    };
  }

  if (!Number.isFinite(newActivityTime) || newActivityTime < 0) {
    return {
      allowed: false,
      status: "error",
      availableTime,
      currentTotal: calculateActivitiesTotal(getActivitiesByDate(selectedDate)),
      newActivityTime,
      finalTotal: calculateActivitiesTotal(getActivitiesByDate(selectedDate)),
      breaksMinutes: 0,
      difference: 0,
      message: "Informe uma duração válida para a atividade.",
    };
  }

  const dayActivities = getActivitiesByDate(selectedDate);
  const activitiesWithoutEditingItem = editingId
    ? dayActivities.filter((activity) => activity.id !== editingId)
    : dayActivities;
  const candidateActivities = newActivityTime > 0
    ? [...activitiesWithoutEditingItem, { durationMinutes: newActivityTime }]
    : activitiesWithoutEditingItem;
  const currentTotal = calculateActivitiesTotal(activitiesWithoutEditingItem);
  const activitiesTotal = calculateActivitiesTotal(candidateActivities);
  const breaksMinutes = calculateBreaksTotal(candidateActivities.length, settings.breakMinutes);
  const finalTotal = activitiesTotal + breaksMinutes;
  const difference = finalTotal - availableTime;

  if (difference > 0) {
    return {
      allowed: false,
      status: "error",
      availableTime,
      currentTotal,
      newActivityTime,
      finalTotal,
      breaksMinutes,
      difference,
      message: `Não foi possível adicionar esta atividade. Ela ultrapassa o tempo disponível do dia em ${formatMinutes(difference)}.`,
    };
  }

  if (difference === 0) {
    return {
      allowed: true,
      status: "limit",
      availableTime,
      currentTotal,
      newActivityTime,
      finalTotal,
      breaksMinutes,
      difference,
      message: "Essa atividade cabe no seu dia, mas deixará o planejamento no limite.",
    };
  }

  return {
    allowed: true,
    status: "available",
    availableTime,
    currentTotal,
    newActivityTime,
    finalTotal,
    breaksMinutes,
    difference,
    message: `Essa atividade cabe no seu dia. Depois dela, ainda restará ${formatMinutes(Math.abs(difference))} disponível.`,
  };
}

async function createActivity(data) {
  const newActivity = {
    id: createId(),
    name: data.name,
    date: data.date,
    durationMinutes: data.durationMinutes,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const nextActivities = await activityRepository.create(newActivity, state.activities);
  if (!nextActivities) return;

  state.activities = nextActivities;
  selectDate(newActivity.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({ title: "Atividade adicionada", message: `"${newActivity.name}" foi cadastrada para ${formatDateForHuman(newActivity.date)}.`, type: "success" });
}

async function updateActivity(activityId, data) {
  const activity = findActivity(activityId);

  if (!activity) {
    showToast({ title: "Atividade não encontrada", message: "Não foi possível editar esta atividade.", type: "error" });
    resetFormMode();
    return;
  }

  if (!canChangeActivity(activity) || isDateLocked(data.date)) {
    showLockedToast();
    return;
  }

  const limitValidation = canAddActivityToDay(data, data.date, activityId);

  if (!limitValidation.allowed) {
    showFormFeedback(limitValidation.message, "error");
    showToast({ title: "Limite de tempo ultrapassado", message: limitValidation.message, type: "error" });
    return;
  }

  const nextActivities = state.activities.map((item) => {
    if (item.id !== activityId) return item;
    return {
      id: item.id,
      name: data.name,
      date: data.date,
      durationMinutes: data.durationMinutes,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: new Date().toISOString(),
    };
  });

  if (!(await activityRepository.saveAll(nextActivities))) return;

  state.activities = nextActivities;
  selectDate(data.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({ title: "Atividade atualizada", message: "As alterações foram salvas com sucesso.", type: "success" });
}

function startEditActivity(activityId) {
  const activity = findActivity(activityId);
  if (!activity || !canChangeActivity(activity)) return;

  state.editingId = activityId;
  elements.nameInput.value = activity.name;
  elements.dateInput.value = activity.date;
  elements.durationInput.value = minutesToInputDuration(getActivityMinutes(activity));
  elements.unitSelect.value = "minutes";
  elements.formTitle.textContent = "Editar atividade";
  elements.submitButton.textContent = "Salvar alterações";
  elements.cancelEditButton.classList.remove("is-hidden");
  clearFormFeedback();
  syncFormAvailability();
  elements.nameInput.focus();
  elements.form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function minutesToInputDuration(minutes) {
  const rounded = Math.round(Number(minutes) || 0);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${hours}:${String(rest).padStart(2, "0")}`;
}

function createActivityCard(activity) {
  const card = document.createElement("article");
  const completed = activity.status === "completed";
  const locked = isDateLocked(activity.date);
  const disabledAttributes = locked ? "disabled aria-disabled=\"true\" title=\"Este dia já foi encerrado\"" : "";
  card.className = `activity-card ${completed ? "is-completed" : ""} ${locked ? "is-locked" : ""}`;
  card.dataset.activityId = activity.id;
  card.innerHTML = `
    <div class="activity-card__top">
      <div>
        <h3 class="activity-card__title">${escapeHTML(activity.name)}</h3>
        <div class="activity-card__meta">
          <span class="meta-pill" title="Data da atividade">${formatDateForHuman(activity.date)}</span>
          <span class="meta-pill" title="Duração planejada">${formatDuration(activity)}</span>
          <span class="status-pill ${completed ? "status-pill--completed" : "status-pill--pending"}">${statusMap[activity.status]}</span>
          ${locked ? `<span class="status-pill status-pill--locked">Encerrado</span>` : ""}
        </div>
      </div>
    </div>
    <div class="activity-card__actions" aria-label="Ações da atividade ${escapeHTML(activity.name)}">
      <button class="action-btn action-btn--done" type="button" data-action="toggle" ${disabledAttributes}>${completed ? "Reabrir" : "Concluir"}</button>
      <button class="action-btn action-btn--edit" type="button" data-action="edit" ${disabledAttributes}>Editar</button>
      <button class="action-btn action-btn--delete" type="button" data-action="delete" ${disabledAttributes}>Excluir</button>
    </div>`;
  return card;
}

function renderPlanningPanel() {
  const settings = getSettingsForDate(state.selectedDate);
  const locked = isDateLocked(state.selectedDate);

  if (elements.availableDurationInput) {
    elements.availableDurationInput.value = settings.availableMinutes ? minutesToInputDuration(settings.availableMinutes) : "";
  }

  elements.startTimeInput.value = settings.startTime || "";
  elements.endTimeInput.value = settings.endTime || "";
  elements.breakTimeInput.value = settings.breakMinutes || "";
  elements.saveSettingsButton.disabled = locked;
  elements.generateScheduleButton.disabled = locked;
  elements.generateSuggestionButton.disabled = locked;
  elements.applySuggestionButton.disabled = locked;
  renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
  renderAiSuggestion();
}

function renderDaySummary() {
  const dayActivities = getActivitiesByDate(state.selectedDate);
  const total = dayActivities.length;
  const completed = dayActivities.filter((activity) => activity.status === "completed").length;
  const pending = total - completed;
  const timeStatus = getDayTimeStatus(dayActivities, getSettingsForDate(state.selectedDate));

  setCounterValue(elements.dayTotalActivities, total);
  setCounterValue(elements.dayPendingActivities, pending);
  setCounterValue(elements.dayCompletedActivities, completed);
  setCounterValue(elements.dayTotalTime, formatMinutes(timeStatus.plannedMinutes));
  elements.activityListDescription.textContent = `Gerencie as atividades de ${formatDateForHuman(state.selectedDate)}.`;
  renderTimeStatusCard(timeStatus);
  renderInstagramCard(timeStatus, dayActivities, completed, pending);
}

function renderTimeStatusCard(timeStatus) {
  if (!elements.dayTimeStatusCard) return;
  elements.dayTimeStatusCard.classList.remove("is-available", "is-limit", "is-error");
  elements.dayTimeStatusCard.classList.add(`is-${timeStatus.status}`);
  elements.statusAvailableTime.textContent = timeStatus.availableMinutes ? formatMinutes(timeStatus.availableMinutes) : "Não informado";
  if (elements.statusActivitiesTime) elements.statusActivitiesTime.textContent = formatMinutes(timeStatus.activitiesMinutes || 0);
  if (elements.statusBreaksTime) elements.statusBreaksTime.textContent = formatMinutes(timeStatus.breaksMinutes || 0);
  elements.statusPlannedTime.textContent = formatMinutes(timeStatus.plannedMinutes || 0);
  elements.statusBalanceLabel.textContent = timeStatus.status === "error" ? "Excesso" : "Restante";
  elements.statusBalanceTime.textContent = timeStatus.status === "error" ? formatMinutes(timeStatus.excessMinutes) : formatMinutes(timeStatus.remainingMinutes);
  elements.statusMessage.textContent = getReadableDayStatus(timeStatus);
}

function renderInstagramCard(timeStatus, activities, completed, pending) {
  if (!elements.instagramShareCard) return;
  elements.instagramCardDate.textContent = formatDateForHuman(state.selectedDate);
  elements.instagramCardAvailable.textContent = `Disponível: ${timeStatus.availableMinutes ? formatMinutes(timeStatus.availableMinutes) : "não informado"}`;
  elements.instagramCardPlanned.textContent = `Total: ${formatMinutes(timeStatus.plannedMinutes || 0)}`;
  elements.instagramCardBalance.textContent = `${timeStatus.status === "error" ? "Excesso" : "Restante"}: ${timeStatus.status === "error" ? formatMinutes(timeStatus.excessMinutes) : formatMinutes(timeStatus.remainingMinutes)}`;
  elements.instagramCardTotal.textContent = `${activities.length} atividade${activities.length === 1 ? "" : "s"} | pausas ${formatMinutes(timeStatus.breaksMinutes || 0)}`;
  elements.instagramCardActivities.innerHTML = "";
  activities.slice(0, 4).forEach((activity) => {
    const item = document.createElement("li");
    item.textContent = `${activity.name} · ${formatDuration(activity)}`;
    elements.instagramCardActivities.appendChild(item);
  });
  if (!activities.length) {
    const item = document.createElement("li");
    item.textContent = "Nenhuma atividade cadastrada";
    elements.instagramCardActivities.appendChild(item);
  }
  elements.instagramCardStatus.textContent = getReadableDayStatus(timeStatus);
  elements.instagramShareCard.className = `instagram-share-card is-${timeStatus.status}`;
}

function generateSchedule(activities, settings) {
  const normalizedSettings = normalizeDaySettings(settings, state.selectedDate);
  const start = parseTime(normalizedSettings.startTime || "08:00");
  const breakMinutes = Math.max(0, Number(normalizedSettings.breakMinutes || 0));
  const endLimit = normalizedSettings.endTime ? parseTime(normalizedSettings.endTime) : null;
  let cursor = start;
  const items = [];

  activities.forEach((activity, index) => {
    const duration = Math.round(getActivityMinutes(activity));
    const activityStart = cursor;
    const activityEnd = activityStart + duration;
    items.push({ type: "activity", name: activity.name, start: activityStart, end: activityEnd, status: activity.status });
    cursor = activityEnd;

    if (index < activities.length - 1 && breakMinutes > 0) {
      items.push({ type: "break", name: "Pausa", start: cursor, end: cursor + breakMinutes, status: "break" });
      cursor += breakMinutes;
    }
  });

  const status = getDayTimeStatus(activities, normalizedSettings);
  const overEnd = endLimit ? Math.max(cursor - endLimit, 0) : 0;

  return {
    items,
    totalActivities: status.activitiesMinutes,
    totalBreaks: status.breaksMinutes,
    totalRequired: status.plannedMinutes,
    availableTime: status.availableMinutes,
    overAvailable: status.excessMinutes,
    overEnd,
  };
}

function renderSchedule(schedule) {
  elements.scheduleWarning.textContent = "";
  elements.scheduleWarning.classList.remove("is-visible");
  elements.scheduleList.innerHTML = "";

  if (!schedule.items.length) {
    elements.scheduleList.innerHTML = `<div class="schedule-empty">Nenhuma atividade para distribuir nesta data.</div>`;
    return;
  }

  if (schedule.overAvailable || schedule.overEnd) {
    const excess = Math.max(schedule.overAvailable, schedule.overEnd);
    elements.scheduleWarning.textContent = `As atividades e pausas deste dia ultrapassam o tempo disponível em ${formatMinutes(excess)}. Ajuste a duração, a pausa ou o tempo disponível.`;
    elements.scheduleWarning.classList.add("is-visible");
  }

  const fragment = document.createDocumentFragment();
  schedule.items.forEach((item) => {
    const row = document.createElement("div");
    row.className = `schedule-item schedule-item--${item.type}`;
    row.innerHTML = `<strong>${formatClock(item.start)} - ${formatClock(item.end)}</strong><span>${escapeHTML(item.name)}</span>${item.status === "completed" ? "<small>Concluída</small>" : ""}`;
    fragment.appendChild(row);
  });
  elements.scheduleList.appendChild(fragment);
}

function validateCurrentDayWithinLimit() {
  const status = getDayTimeStatus(getActivitiesByDate(state.selectedDate), getSettingsForDate(state.selectedDate));

  if (!status.availableMinutes) {
    showToast({ title: "Tempo disponível obrigatório", message: "Defina o tempo disponível deste dia antes de continuar.", type: "error" });
    return false;
  }

  if (status.status === "error") {
    showToast({ title: "Limite de tempo ultrapassado", message: status.message, type: "error" });
    return false;
  }

  if (status.status === "limit") {
    showToast({ title: "No limite", message: status.message, type: "info" });
  }

  return true;
}

async function generateScheduleForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }

  const settings = readSettingsForm();
  const settingsValidation = validateDaySettings(settings);

  if (!settingsValidation.isValid) {
    showToast({ title: "Planejamento inválido", message: settingsValidation.message, type: "error" });
    return;
  }

  const status = getDayTimeStatus(getActivitiesByDate(state.selectedDate), settings);

  if (status.status === "error") {
    renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
    showToast({ title: "Agenda não gerada", message: status.message, type: "error" });
    return;
  }

  state.daySettings[state.selectedDate] = settings;
  if (!(await daySettingsRepository.saveAll(state.daySettings))) return;

  renderApp();
  renderSchedule(generateSchedule(getActivitiesByDate(state.selectedDate), settings));
  showToast({
    title: "Agenda gerada",
    message: status.status === "limit" ? status.message : "A agenda automática respeitou as pausas entre atividades.",
    type: status.status === "limit" ? "info" : "success",
  });
}

async function saveSelectedDaySettings(event) {
  event.preventDefault();
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }

  const settings = readSettingsForm();
  const validation = validateDaySettings(settings);

  if (!validation.isValid) {
    showToast({ title: "Planejamento inválido", message: validation.message, type: "error" });
    return;
  }

  const status = getDayTimeStatus(getActivitiesByDate(state.selectedDate), settings);

  if (status.status === "error") {
    showToast({ title: "Tempo ultrapassado", message: status.message, type: "error" });
    return;
  }

  state.daySettings[state.selectedDate] = settings;
  if (!(await daySettingsRepository.saveAll(state.daySettings))) return;

  renderApp();
  showToast({ title: "Planejamento salvo", message: status.status === "limit" ? status.message : "O tempo disponível e a pausa foram atualizados.", type: status.status === "limit" ? "info" : "success" });
}

function generateDayShareText(selectedDate) {
  const activities = getActivitiesByDate(selectedDate);
  const settings = getSettingsForDate(selectedDate);
  const timeStatus = getDayTimeStatus(activities, settings);
  const schedule = generateSchedule(activities, settings);
  const suggestion = state.aiSuggestions[selectedDate];
  const completed = activities.filter((activity) => activity.status === "completed").length;
  const pending = activities.length - completed;
  const activityLines = activities.length
    ? activities.map((activity, index) => `${index + 1}. ${activity.name} — ${formatDuration(activity)} — ${statusMap[activity.status]}`)
    : ["Nenhuma atividade cadastrada para esta data."];
  const scheduleLines = schedule.items.length
    ? schedule.items.map((item) => `${formatClock(item.start)} - ${formatClock(item.end)} | ${item.name}`)
    : [];
  const statusLine = timeStatus.status === "error"
    ? `Tempo excedido: ${formatMinutes(timeStatus.excessMinutes)}`
    : timeStatus.status === "limit"
      ? "Tempo restante: 0min (no limite)"
      : `Tempo restante: ${formatMinutes(timeStatus.remainingMinutes)}`;

  return [
    `Minhas atividades de ${formatDateForShare(selectedDate)}`,
    "",
    "Resumo do dia:",
    `Tempo disponível: ${timeStatus.availableMinutes ? formatMinutes(timeStatus.availableMinutes) : "não informado"}`,
    `Tempo em atividades: ${formatMinutes(timeStatus.activitiesMinutes)}`,
    `Tempo em pausas: ${formatMinutes(timeStatus.breaksMinutes)}`,
    `Tempo total planejado: ${formatMinutes(timeStatus.plannedMinutes)}`,
    statusLine,
    `Pausa entre atividades: ${formatMinutes(settings.breakMinutes)}`,
    "",
    "Atividades:",
    ...activityLines,
    "",
    "Status:",
    `Total: ${activities.length}`,
    `Pendentes: ${pending}`,
    `Concluídas: ${completed}`,
    scheduleLines.length ? "" : null,
    scheduleLines.length ? "Agenda sugerida:" : null,
    ...scheduleLines,
    suggestion ? "" : null,
    suggestion ? "Sugestão inteligente:" : null,
    suggestion ? suggestion.text : null,
  ].filter((line) => line !== null).join("\n");
}

function getActivityPreviewStatus() {
  const data = getSanitizedFormData();
  const selectedDate = data.date || state.selectedDate;

  if (!isValidISODate(selectedDate)) return null;

  if (!getDayAvailableTime(selectedDate)) {
    return canAddActivityToDay({ durationMinutes: 0 }, selectedDate, state.editingId);
  }

  if (!data.durationInput) return null;

  if (!isValidDurationInput(data.durationInput)) {
    return {
      allowed: false,
      status: "error",
      message: "Informe a duração no formato correto, como 2:30, 0:45 ou 2. Não use vírgula ou ponto.",
    };
  }

  return canAddActivityToDay(data, selectedDate, state.editingId);
}

function updateRealtimeActivityFeedback() {
  if (state.editingId && !findActivity(state.editingId)) return;

  const selectedDate = elements.dateInput.value || state.selectedDate;
  const locked = isValidISODate(selectedDate) && isDateLocked(selectedDate);

  if (locked) {
    setActivityFormDisabled(true);
    showFormFeedback("Este dia já foi encerrado. Você pode visualizar as atividades, mas não pode alterá-las.", "error");
    return;
  }

  setActivityFormDisabled(false);

  if (!isValidISODate(selectedDate)) {
    elements.submitButton.disabled = true;
    showFormFeedback("Selecione uma data válida para cadastrar a atividade.", "error");
    return;
  }

  if (!getDayAvailableTime(selectedDate)) {
    elements.submitButton.disabled = true;
    showFormFeedback("Defina o tempo disponível deste dia antes de adicionar atividades.", "error");
    return;
  }

  const preview = getActivityPreviewStatus();

  if (!preview) {
    elements.submitButton.disabled = false;
    if (!state.editingId) clearFormFeedback();
    return;
  }

  elements.submitButton.disabled = !preview.allowed;

  if (!preview.allowed) {
    showFormFeedback(preview.message, "error");
    return;
  }

  showFormFeedback(preview.message, preview.status === "limit" ? "warning" : "success");
}

function bindEvents() {
  elements.form.addEventListener("submit", handleFormSubmit);
  elements.cancelEditButton.addEventListener("click", resetFormMode);
  elements.activityList.addEventListener("click", handleActivityAction);
  elements.calendarGrid.addEventListener("click", handleCalendarClick);
  elements.previousMonthButton.addEventListener("click", () => changeVisibleMonth(-1));
  elements.nextMonthButton.addEventListener("click", () => changeVisibleMonth(1));
  elements.previousDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, -1)));
  elements.nextDayButton.addEventListener("click", () => selectDate(addDays(state.selectedDate, 1)));
  elements.todayButton.addEventListener("click", () => selectDate(getTodayBrasiliaISO()));
  elements.shareWhatsAppButton.addEventListener("click", shareOnWhatsApp);
  elements.shareInstagramButton.addEventListener("click", shareOnInstagram);
  elements.copySummaryButton.addEventListener("click", copyShareText);
  elements.nativeShareButton.addEventListener("click", nativeShare);
  elements.daySettingsForm.addEventListener("submit", saveSelectedDaySettings);
  elements.generateScheduleButton.addEventListener("click", generateScheduleForSelectedDay);
  elements.generateSuggestionButton.addEventListener("click", generateSuggestionForSelectedDay);
  elements.applySuggestionButton.addEventListener("click", applySuggestionForSelectedDay);

  [elements.durationInput, elements.dateInput, elements.nameInput].forEach((field) => {
    field.addEventListener("input", updateRealtimeActivityFeedback);
    field.addEventListener("change", updateRealtimeActivityFeedback);
  });

  [elements.availableDurationInput, elements.breakTimeInput, elements.startTimeInput, elements.endTimeInput].filter(Boolean).forEach((field) => {
    field.addEventListener("input", () => {
      const settings = readSettingsForm();
      if (validateDaySettings(settings).isValid) {
        renderTimeStatusCard(getDayTimeStatus(getActivitiesByDate(state.selectedDate), settings));
      }
      updateRealtimeActivityFeedback();
    });
  });

  elements.dateInput.addEventListener("change", () => {
    if (isValidISODate(elements.dateInput.value) && !state.editingId) selectDate(elements.dateInput.value);
  });

  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentFilter = button.dataset.filter;
      updateActiveFilter();
      renderActivities();
    });
  });

  window.addEventListener("storage", async (event) => {
    if ([STORAGE_KEY, DAY_SETTINGS_KEY, AI_SUGGESTIONS_KEY].includes(event.key)) {
      state.activities = await activityRepository.getAll();
      state.daySettings = await daySettingsRepository.getAll();
      state.aiSuggestions = await aiSuggestionRepository.getAll();
      renderApp();
    }
  });
}

function sumDurationMinutes(activities) {
  return calculateActivitiesTotal(activities);
}

function parseDurationToMinutes(value) {
  const input = String(value ?? "").trim();

  if (!input) return null;
  if (input.includes(",") || input.includes(".")) return null;

  if (/^\d+$/.test(input)) {
    const hours = Number(input);
    const totalMinutes = hours * 60;
    return totalMinutes > 0 ? totalMinutes : null;
  }

  const match = input.match(/^(\d+):([0-5]\d)$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const totalMinutes = hours * 60 + minutes;

  return totalMinutes > 0 ? totalMinutes : null;
}

function isValidDurationInput(value) {
  return parseDurationToMinutes(value) !== null;
}

function formatMinutes(minutes) {
  const total = Number(minutes);

  if (!Number.isFinite(total) || total <= 0) return "0min";

  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;

  if (hours && mins) return `${hours}h${mins}min`;
  if (hours) return `${hours}h`;
  return `${mins}min`;
}

function getEffectiveDaySettingsForDate(selectedDate) {
  if (selectedDate === state.selectedDate && elements.availableDurationInput) {
    const typedAvailable = parseDurationToMinutes(elements.availableDurationInput.value);
    const typedBreak = elements.breakTimeInput.value === "" ? 0 : Number(elements.breakTimeInput.value);

    if (typedAvailable !== null && Number.isInteger(typedBreak) && typedBreak >= 0) {
      return {
        date: selectedDate,
        availableMinutes: typedAvailable,
        startTime: elements.startTimeInput.value,
        endTime: elements.endTimeInput.value,
        breakMinutes: typedBreak,
      };
    }
  }

  return getSettingsForDate(selectedDate);
}

function getDayAvailableMinutes(selectedDate) {
  return getEffectiveDaySettingsForDate(selectedDate).availableMinutes;
}

function getDayAvailableTime(selectedDate) {
  return getDayAvailableMinutes(selectedDate);
}

function canAddActivityToDay(newActivity, selectedDate, editingId = null) {
  const settings = getEffectiveDaySettingsForDate(selectedDate);
  const dayActivities = getActivitiesByDate(selectedDate);
  const activitiesToCalculate = editingId
    ? dayActivities.filter((activity) => activity.id !== editingId)
    : dayActivities;
  const currentTotal = activitiesToCalculate.reduce((total, activity) => total + Number(activity.durationMinutes || 0), 0);
  const newActivityTime = Number(newActivity.durationMinutes || 0);
  const availableTime = Number(settings.availableMinutes || 0);

  if (!availableTime || availableTime <= 0) {
    return {
      allowed: false,
      status: "error",
      message: "Defina o tempo disponível deste dia antes de adicionar atividades.",
    };
  }

  if (!Number.isFinite(newActivityTime) || newActivityTime <= 0) {
    return {
      allowed: false,
      status: "error",
      message: "Informe uma duração válida. Exemplo: 2:40 para 2 horas e 40 minutos.",
    };
  }

  const nextActivitiesCount = activitiesToCalculate.length + 1;
  const breaksTotal = calculateBreaksTotal(nextActivitiesCount, settings.breakMinutes);
  const finalTotal = currentTotal + newActivityTime + breaksTotal;
  const difference = finalTotal - availableTime;

  if (difference > 0) {
    return {
      allowed: false,
      status: "error",
      message: `Não foi possível adicionar esta atividade. Ela ultrapassa o tempo disponível do dia em ${formatMinutes(difference)}.`,
    };
  }

  if (difference === 0) {
    return {
      allowed: true,
      status: "limit",
      message: "Essa atividade cabe no seu dia, mas deixará o planejamento no limite.",
    };
  }

  return {
    allowed: true,
    status: "available",
    message: `Essa atividade cabe no seu dia. Depois dela, ainda restará ${formatMinutes(Math.abs(difference))} disponível.`,
  };
}

function getSanitizedFormData() {
  const durationMinutes = parseDurationToMinutes(elements.durationInput.value);

  return {
    name: elements.nameInput.value.trim().replace(/\s+/g, " "),
    date: elements.dateInput.value || state.selectedDate,
    durationInput: elements.durationInput.value.trim(),
    durationMinutes,
    status: "pending",
  };
}

function validateActivityData(data) {
  if (!data.name) return { isValid: false, message: "Informe o nome da atividade." };
  if (data.name.length < 2) return { isValid: false, message: "O nome da atividade precisa ter pelo menos 2 caracteres." };
  if (!isValidISODate(data.date)) return { isValid: false, message: "Informe uma data válida." };
  if (data.durationMinutes === null) {
    return { isValid: false, message: "Informe uma duração válida. Exemplo: 2:40 para 2 horas e 40 minutos." };
  }
  return { isValid: true, message: "" };
}

async function persistVisibleDaySettingsIfNeeded(selectedDate) {
  if (selectedDate !== state.selectedDate) return true;

  const settings = getEffectiveDaySettingsForDate(selectedDate);

  if (!settings.availableMinutes) return false;

  state.daySettings[selectedDate] = settings;
  return daySettingsRepository.saveAll(state.daySettings);
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const activityData = getSanitizedFormData();
  const validation = validateActivityData(activityData);

  if (!validation.isValid) {
    showFormFeedback(validation.message, "error");
    return;
  }

  if (isDateLocked(activityData.date)) {
    showLockedToast();
    showFormFeedback("Este dia já foi encerrado. Você pode visualizar as atividades, mas não pode alterá-las.", "error");
    return;
  }

  const limitValidation = canAddActivityToDay(activityData, activityData.date, state.editingId);

  if (!limitValidation.allowed) {
    showFormFeedback(limitValidation.message, "error");
    showToast({ title: "Limite de tempo ultrapassado", message: limitValidation.message, type: "error" });
    return;
  }

  const settingsSaved = await persistVisibleDaySettingsIfNeeded(activityData.date);
  if (!settingsSaved) {
    showFormFeedback("Defina o tempo disponível deste dia antes de adicionar atividades.", "error");
    return;
  }

  showFormFeedback(limitValidation.message, limitValidation.status === "limit" ? "warning" : "success");

  if (state.editingId) {
    await updateActivity(state.editingId, activityData);
    return;
  }

  await createActivity(activityData);
}

async function createActivity(data) {
  const newActivity = {
    id: createId(),
    name: data.name,
    durationMinutes: data.durationMinutes,
    status: "pending",
    date: data.date,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const nextActivities = await activityRepository.create(newActivity, state.activities);
  if (!nextActivities) return;

  state.activities = nextActivities;
  selectDate(newActivity.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({ title: "Atividade adicionada", message: `"${newActivity.name}" foi cadastrada com ${formatMinutes(newActivity.durationMinutes)}.`, type: "success" });
}

async function updateActivity(activityId, data) {
  const activity = findActivity(activityId);

  if (!activity) {
    showToast({ title: "Atividade não encontrada", message: "Não foi possível editar esta atividade.", type: "error" });
    resetFormMode();
    return;
  }

  if (!canChangeActivity(activity) || isDateLocked(data.date)) {
    showLockedToast();
    return;
  }

  const limitValidation = canAddActivityToDay(data, data.date, activityId);

  if (!limitValidation.allowed) {
    showFormFeedback(limitValidation.message, "error");
    showToast({ title: "Limite de tempo ultrapassado", message: limitValidation.message, type: "error" });
    return;
  }

  const nextActivities = state.activities.map((item) => {
    if (item.id !== activityId) return item;
    return {
      id: item.id,
      name: data.name,
      durationMinutes: data.durationMinutes,
      status: item.status,
      date: data.date,
      createdAt: item.createdAt,
      updatedAt: new Date().toISOString(),
    };
  });

  if (!(await activityRepository.saveAll(nextActivities))) return;

  state.activities = nextActivities;
  selectDate(data.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({ title: "Atividade atualizada", message: "As alterações foram salvas com sucesso.", type: "success" });
}

function validateCurrentDayWithinLimit() {
  const status = getDayTimeStatus(getActivitiesByDate(state.selectedDate), getEffectiveDaySettingsForDate(state.selectedDate));

  if (!status.availableMinutes) {
    showToast({ title: "Tempo disponível obrigatório", message: "Defina o tempo disponível deste dia antes de continuar.", type: "error" });
    return false;
  }

  if (status.status === "error") {
    showToast({ title: "Limite de tempo ultrapassado", message: status.message, type: "error" });
    return false;
  }

  return true;
}

async function applySuggestionForSelectedDay() {
  if (isDateLocked(state.selectedDate)) {
    showLockedToast();
    return;
  }

  if (!validateCurrentDayWithinLimit()) return;

  const suggestion = state.aiSuggestions[state.selectedDate];
  if (!suggestion?.orderedIds?.length) return;

  const order = new Map(suggestion.orderedIds.map((id, index) => [id, index]));
  const selected = state.activities
    .filter((activity) => activity.date === state.selectedDate)
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  const others = state.activities.filter((activity) => activity.date !== state.selectedDate);

  state.activities = [...selected, ...others];

  if (!(await activityRepository.saveAll(state.activities))) return;

  renderApp();
  showToast({ title: "Sugestão aplicada", message: "A ordem das atividades do dia foi reorganizada.", type: "success" });
}

/* Correção consolidada do fluxo de salvamento e duração em minutos. */
function parseDurationToMinutes(value) {
  const input = String(value).trim();

  if (!input) return null;
  if (input.includes(",") || input.includes(".")) return null;

  if (/^\d+$/.test(input)) {
    const hours = Number(input);
    const totalMinutes = hours * 60;
    return totalMinutes > 0 ? totalMinutes : null;
  }

  const match = input.match(/^(\d+):([0-5]\d)$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const totalMinutes = hours * 60 + minutes;

  return totalMinutes > 0 ? totalMinutes : null;
}

function canAddActivityToDay(newActivity, selectedDate, editingId = null) {
  const settings = getEffectiveDaySettingsForDate(selectedDate);
  const availableTime = Number(settings.availableMinutes || 0);
  const newActivityTime = Number(newActivity.durationMinutes);
  const dayActivities = getActivitiesByDate(selectedDate);
  const activitiesWithoutEditingItem = editingId
    ? dayActivities.filter((activity) => activity.id !== editingId)
    : dayActivities;

  if (!availableTime || availableTime <= 0) {
    return {
      allowed: false,
      status: "error",
      reason: "missing-available",
      message: "Defina o tempo disponível deste dia antes de adicionar atividades.",
    };
  }

  if (!Number.isFinite(newActivityTime) || newActivityTime <= 0) {
    return {
      allowed: false,
      status: "error",
      reason: "invalid-duration",
      message: "Informe uma duração válida. Exemplo: 2:40 para 2 horas e 40 minutos.",
    };
  }

  const candidateActivities = [...activitiesWithoutEditingItem, { durationMinutes: newActivityTime }];
  const currentTotal = calculateActivitiesTotal(activitiesWithoutEditingItem) + calculateBreaksTotal(activitiesWithoutEditingItem.length, settings.breakMinutes);
  const finalTotal = calculateActivitiesTotal(candidateActivities) + calculateBreaksTotal(candidateActivities.length, settings.breakMinutes);
  const difference = finalTotal - availableTime;

  if (difference > 0) {
    return {
      allowed: false,
      status: "error",
      currentTotal,
      finalTotal,
      difference,
      message: `Não foi possível adicionar esta atividade. Ela ultrapassa o tempo disponível do dia em ${formatMinutes(difference)}.`,
    };
  }

  if (difference === 0) {
    return {
      allowed: true,
      status: "limit",
      currentTotal,
      finalTotal,
      difference,
      message: "Essa atividade cabe no seu dia, mas deixará o planejamento no limite.",
    };
  }

  return {
    allowed: true,
    status: "available",
    currentTotal,
    finalTotal,
    difference,
    message: `Essa atividade cabe no seu dia. Depois dela, ainda restará ${formatMinutes(Math.abs(difference))} disponível.`,
  };
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const activityData = getSanitizedFormData();
  const validation = validateActivityData(activityData);

  if (!validation.isValid) {
    showFormFeedback(validation.message, "error");
    return;
  }

  if (isDateLocked(activityData.date)) {
    showLockedToast();
    showFormFeedback("Este dia já foi encerrado. Você pode visualizar as atividades, mas não pode alterá-las.", "error");
    return;
  }

  const limitValidation = canAddActivityToDay(activityData, activityData.date, state.editingId);

  if (!limitValidation.allowed) {
    showFormFeedback(limitValidation.message, "error");
    showToast({
      title: limitValidation.reason === "missing-available" ? "Tempo disponível obrigatório" : "Limite de tempo ultrapassado",
      message: limitValidation.message,
      type: "error",
    });
    return;
  }

  const settingsSaved = await persistVisibleDaySettingsIfNeeded(activityData.date);
  if (!settingsSaved) {
    showFormFeedback("Defina o tempo disponível deste dia antes de adicionar atividades.", "error");
    return;
  }

  if (state.editingId) {
    await updateActivity(state.editingId, activityData, limitValidation);
    return;
  }

  await createActivity(activityData, limitValidation);
}

async function createActivity(data, limitValidation = null) {
  const now = new Date().toISOString();
  const newActivity = {
    id: createId(),
    name: data.name,
    durationMinutes: data.durationMinutes,
    date: data.date,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const nextActivities = await activityRepository.create(newActivity, state.activities);
  if (!nextActivities) return false;

  state.activities = nextActivities;
  selectDate(newActivity.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({
    title: limitValidation?.status === "limit" ? "Planejamento no limite" : "Atividade adicionada",
    message: limitValidation?.message || `"${newActivity.name}" foi cadastrada com ${formatMinutes(newActivity.durationMinutes)}.`,
    type: limitValidation?.status === "limit" ? "info" : "success",
  });
  return true;
}

async function updateActivity(activityId, data, limitValidation = null) {
  const activity = findActivity(activityId);

  if (!activity) {
    showToast({ title: "Atividade não encontrada", message: "Não foi possível editar esta atividade.", type: "error" });
    resetFormMode();
    return false;
  }

  if (!canChangeActivity(activity) || isDateLocked(data.date)) {
    showLockedToast();
    return false;
  }

  const validation = limitValidation || canAddActivityToDay(data, data.date, activityId);

  if (!validation.allowed) {
    showFormFeedback(validation.message, "error");
    showToast({ title: "Limite de tempo ultrapassado", message: validation.message, type: "error" });
    return false;
  }

  const nextActivities = state.activities.map((item) => {
    if (item.id !== activityId) return item;
    return {
      id: item.id,
      name: data.name,
      durationMinutes: data.durationMinutes,
      status: item.status,
      date: data.date,
      createdAt: item.createdAt,
      updatedAt: new Date().toISOString(),
    };
  });

  if (!(await activityRepository.saveAll(nextActivities))) return false;

  state.activities = nextActivities;
  selectDate(data.date, { render: false });
  resetFormMode();
  renderApp();
  showToast({
    title: validation.status === "limit" ? "Planejamento no limite" : "Atividade atualizada",
    message: validation.status === "limit" ? validation.message : "As alterações foram salvas com sucesso.",
    type: validation.status === "limit" ? "info" : "success",
  });
  return true;
}

function createActivityCard(activity) {
  const card = document.createElement("article");
  const completed = activity.status === "completed";
  const locked = isDateLocked(activity.date);
  const disabledAttributes = locked ? "disabled aria-disabled=\"true\" title=\"Este dia já foi encerrado\"" : "";
  card.className = `activity-card ${completed ? "is-completed" : ""} ${locked ? "is-locked" : ""}`;
  card.dataset.activityId = activity.id;
  card.innerHTML = `
    <div class="activity-card__top">
      <div>
        <h3 class="activity-card__title">${escapeHTML(activity.name)}</h3>
        <div class="activity-card__meta">
          <span class="meta-pill" title="Data da atividade">${formatDateForHuman(activity.date)}</span>
          <span class="meta-pill" title="Duração planejada">${formatMinutes(activity.durationMinutes)}</span>
          <span class="status-pill ${completed ? "status-pill--completed" : "status-pill--pending"}">${statusMap[activity.status]}</span>
          ${locked ? `<span class="status-pill status-pill--locked">Encerrado</span>` : ""}
        </div>
      </div>
    </div>
    <div class="activity-card__actions" aria-label="Ações da atividade ${escapeHTML(activity.name)}">
      <button class="action-btn action-btn--done" type="button" data-action="toggle" ${disabledAttributes}>${completed ? "Reabrir" : "Concluir"}</button>
      <button class="action-btn action-btn--edit" type="button" data-action="edit" ${disabledAttributes}>Editar</button>
      <button class="action-btn action-btn--delete" type="button" data-action="delete" ${disabledAttributes}>Excluir</button>
    </div>`;
  return card;
}

document.addEventListener("DOMContentLoaded", () => {
  const suggestionCard = document.querySelector("#aiSuggestionCard");
  const panels = document.querySelector(".main-panels");
  if (!suggestionCard || !panels || suggestionCard.closest(".suggestion-panel")) return;

  const section = document.createElement("section");
  section.className = "suggestion-panel planning-panel reveal is-visible";
  section.setAttribute("aria-labelledby", "suggestionTitle");
  section.innerHTML = `
    <div class="section-heading">
      <span class="eyebrow">Sugestão inteligente</span>
      <h2 id="suggestionTitle">Próximo melhor ajuste</h2>
    </div>`;
  section.appendChild(suggestionCard);
  panels.appendChild(section);
});

const THEME_STORAGE_KEY = "activity-flow.theme.v1";

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  const initialTheme = savedTheme === "dark" || savedTheme === "light"
    ? savedTheme
    : prefersDark
      ? "dark"
      : "light";

  applyTheme(initialTheme, { persist: false });

  const toggleButton = document.querySelector("#themeToggle");
  if (toggleButton) {
    toggleButton.addEventListener("click", toggleTheme);
  }
}

function toggleTheme() {
  const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
  applyTheme(nextTheme);
}

function applyTheme(theme, options = {}) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  const isDark = normalizedTheme === "dark";
  const toggleButton = document.querySelector("#themeToggle");

  document.body.classList.toggle("dark-mode", isDark);
  document.documentElement.dataset.theme = normalizedTheme;

  if (toggleButton) {
    toggleButton.setAttribute("aria-pressed", String(isDark));
    toggleButton.setAttribute("aria-label", isDark ? "Alternar para modo claro" : "Alternar para modo escuro");
    const icon = toggleButton.querySelector(".theme-toggle__icon");
    const text = toggleButton.querySelector(".theme-toggle__text");
    if (icon) icon.textContent = isDark ? "☼" : "☾";
    if (text) text.textContent = isDark ? "Modo claro" : "Modo escuro";
  }

  if (options.persist !== false) {
    localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
  }
}

document.addEventListener("DOMContentLoaded", initTheme);

/* Camada de experiência: Meu dia, calendário móvel e compartilhamento no fim do fluxo. */
Object.assign(elements, {
  myDayActivities: document.querySelector("#myDayActivities"),
  myDayAvailable: document.querySelector("#myDayAvailable"),
  myDayPlanned: document.querySelector("#myDayPlanned"),
  myDayBalanceLabel: document.querySelector("#myDayBalanceLabel"),
  myDayBalance: document.querySelector("#myDayBalance"),
  myDayMessage: document.querySelector("#myDayMessage"),
  calendarToggle: document.querySelector("#calendarToggle"),
});

function renderSelectedDateHeader() {
  const locked = isDateLocked(state.selectedDate);
  const dayActivities = getActivitiesByDate(state.selectedDate);
  const timeStatus = getDayTimeStatus(dayActivities, getEffectiveDaySettingsForDate(state.selectedDate));

  elements.selectedDateLabel.textContent = formatDateForHuman(state.selectedDate, { includeWeekday: true });
  elements.selectedDateStatus.textContent = locked ? "Dia encerrado para alterações" : getReadableDayStatus(timeStatus);
  elements.lockedDayMessage.classList.toggle("is-visible", locked);

  renderMyDayCard(dayActivities, timeStatus);
}

function renderMyDayCard(dayActivities, timeStatus) {
  if (!elements.myDayActivities) return;

  elements.myDayActivities.textContent = `${dayActivities.length}`;
  elements.myDayAvailable.textContent = timeStatus.availableMinutes ? formatMinutes(timeStatus.availableMinutes) : "Não informado";
  elements.myDayPlanned.textContent = formatMinutes(timeStatus.plannedMinutes || 0);
  elements.myDayBalanceLabel.textContent = timeStatus.status === "error" ? "Excesso" : "Restante";
  elements.myDayBalance.textContent = timeStatus.status === "error" ? formatMinutes(timeStatus.excessMinutes) : formatMinutes(timeStatus.remainingMinutes);
  elements.myDayMessage.textContent = getReadableDayStatus(timeStatus);
}

function getReadableDayStatus(timeStatus) {
  if (!timeStatus.availableMinutes) return "Defina o tempo disponível para começar a organizar seu dia.";
  if (timeStatus.status === "error") return `Essa atividade ultrapassa o tempo disponível em ${formatMinutes(timeStatus.excessMinutes)}.`;
  if (timeStatus.status === "limit") return "Seu planejamento está no limite.";
  if (timeStatus.remainingMinutes > 0) return `Você ainda tem ${formatMinutes(timeStatus.remainingMinutes)} disponível.`;
  return "Seu dia está bem distribuído.";
}

function renderInstagramCard(timeStatus, activities, completed, pending) {
  if (!elements.instagramShareCard) return;

  const hasActivities = activities.length > 0;
  elements.instagramCardDate.textContent = formatDateForHuman(state.selectedDate);
  elements.instagramCardAvailable.textContent = `Disponível: ${timeStatus.availableMinutes ? formatMinutes(timeStatus.availableMinutes) : "não informado"}`;
  elements.instagramCardPlanned.textContent = `Planejado: ${formatMinutes(timeStatus.plannedMinutes || 0)}`;
  elements.instagramCardBalance.textContent = `${timeStatus.status === "error" ? "Excesso" : "Restante"}: ${timeStatus.status === "error" ? formatMinutes(timeStatus.excessMinutes) : formatMinutes(timeStatus.remainingMinutes)}`;
  elements.instagramCardTotal.textContent = `${activities.length} atividade${activities.length === 1 ? "" : "s"} | ${pending} pend. | ${completed} concl.`;
  elements.instagramCardActivities.innerHTML = "";

  if (hasActivities) {
    activities.slice(0, 4).forEach((activity) => {
      const item = document.createElement("li");
      item.textContent = `${activity.name} · ${formatMinutes(activity.durationMinutes)}`;
      elements.instagramCardActivities.appendChild(item);
    });
  }

  elements.instagramCardStatus.textContent = hasActivities
    ? getReadableDayStatus(timeStatus)
    : "Adicione atividades para gerar um resumo compartilhável.";
  elements.instagramShareCard.className = `instagram-share-card is-${timeStatus.status}${hasActivities ? "" : " is-empty"}`;
}

function getSuggestedTimeRange(activity) {
  if (!activity || activity.date !== state.selectedDate) return "";

  const settings = getEffectiveDaySettingsForDate(state.selectedDate);
  const start = parseTime(settings.startTime || "08:00");
  const breakMinutes = Math.max(0, Number(settings.breakMinutes || 0));
  let cursor = start;

  for (const item of getActivitiesByDate(state.selectedDate)) {
    const activityStart = cursor;
    const activityEnd = activityStart + Number(item.durationMinutes || 0);
    if (item.id === activity.id) return `${formatClock(activityStart)} - ${formatClock(activityEnd)}`;
    cursor = activityEnd + breakMinutes;
  }

  return "";
}

function createActivityCard(activity) {
  const card = document.createElement("article");
  const completed = activity.status === "completed";
  const locked = isDateLocked(activity.date);
  const disabledAttributes = locked ? "disabled aria-disabled=\"true\" title=\"Este dia já foi encerrado\"" : "";
  const suggestedTime = getSuggestedTimeRange(activity);
  card.className = `activity-card ${completed ? "is-completed" : ""} ${locked ? "is-locked" : ""}`;
  card.dataset.activityId = activity.id;
  card.innerHTML = `
    <div class="activity-card__top">
      <div>
        <h3 class="activity-card__title">${escapeHTML(activity.name)}</h3>
        <div class="activity-card__meta">
          <span class="meta-pill" title="Duração planejada">${formatMinutes(activity.durationMinutes)}</span>
          <span class="status-pill ${completed ? "status-pill--completed" : "status-pill--pending"}">${statusMap[activity.status]}</span>
          ${suggestedTime ? `<span class="meta-pill activity-card__schedule" title="Horário sugerido">${suggestedTime}</span>` : ""}
          ${locked ? `<span class="status-pill status-pill--locked">Encerrado</span>` : ""}
        </div>
      </div>
    </div>
    <div class="activity-card__actions" aria-label="Ações da atividade ${escapeHTML(activity.name)}">
      <button class="action-btn action-btn--done" type="button" data-action="toggle" ${disabledAttributes}>${completed ? "Reabrir" : "Concluir"}</button>
      <button class="action-btn action-btn--edit" type="button" data-action="edit" ${disabledAttributes}>Editar</button>
      <button class="action-btn action-btn--delete" type="button" data-action="delete" ${disabledAttributes}>Excluir</button>
    </div>`;
  return card;
}

document.addEventListener("DOMContentLoaded", () => {
  const panels = document.querySelector(".main-panels");
  const shareActions = document.querySelector(".day-summary-panel .share-actions");
  const shareCard = document.querySelector("#instagramShareCard");

  if (panels && shareActions && shareCard && !document.querySelector(".sharing-panel")) {
    const sharingPanel = document.createElement("section");
    sharingPanel.className = "sharing-panel reveal is-visible";
    sharingPanel.setAttribute("aria-labelledby", "sharingTitle");
    sharingPanel.innerHTML = `
      <div class="section-heading">
        <span class="eyebrow">Compartilhamento</span>
        <h2 id="sharingTitle">Resumo do dia</h2>
      </div>`;
    sharingPanel.appendChild(shareCard);
    sharingPanel.appendChild(shareActions);
    panels.appendChild(sharingPanel);
  }

  const suggestionTitle = document.querySelector("#suggestionTitle");
  if (suggestionTitle) suggestionTitle.textContent = "Assistente de planejamento";

  const aiText = document.querySelector("#aiSuggestionText");
  if (aiText && !state.aiSuggestions[state.selectedDate]) {
    aiText.textContent = "Posso sugerir a melhor ordem das suas atividades com base no tempo disponível do dia.";
  }

  const applyButton = document.querySelector("#applySuggestionButton");
  if (applyButton) applyButton.textContent = "Organizar meu dia";

  if (elements.calendarToggle) {
    elements.calendarToggle.addEventListener("click", () => {
      const calendar = document.querySelector("#calendar");
      const expanded = elements.calendarToggle.getAttribute("aria-expanded") === "true";
      elements.calendarToggle.setAttribute("aria-expanded", String(!expanded));
      elements.calendarToggle.textContent = expanded ? "Ver calendário" : "Ocultar calendário";
      calendar?.classList.toggle("is-open", !expanded);
    });
  }
});

function formatMyDayDate(dateString) {
  const baseDate = formatDateForHuman(dateString);
  return dateString === getTodayBrasiliaISO() ? `Hoje, ${baseDate}` : baseDate;
}

function renderSelectedDateHeader() {
  const locked = isDateLocked(state.selectedDate);
  const dayActivities = getActivitiesByDate(state.selectedDate);
  const timeStatus = getDayTimeStatus(dayActivities, getEffectiveDaySettingsForDate(state.selectedDate));

  elements.selectedDateLabel.textContent = formatMyDayDate(state.selectedDate);
  elements.selectedDateStatus.textContent = locked ? "Dia encerrado para alterações" : getReadableDayStatus(timeStatus);
  elements.lockedDayMessage.classList.toggle("is-visible", locked);

  renderMyDayCard(dayActivities, timeStatus);
}

function getSuggestedTimeRange(activity) {
  if (!activity || activity.date !== state.selectedDate) return "";

  const settings = getEffectiveDaySettingsForDate(state.selectedDate);
  if (!settings.availableMinutes) return "";

  const start = parseTime(settings.startTime || "08:00");
  const breakMinutes = Math.max(0, Number(settings.breakMinutes || 0));
  let cursor = start;

  for (const item of getActivitiesByDate(state.selectedDate)) {
    const activityStart = cursor;
    const activityEnd = activityStart + Number(item.durationMinutes || 0);
    if (item.id === activity.id) return `${formatClock(activityStart)} - ${formatClock(activityEnd)}`;
    cursor = activityEnd + breakMinutes;
  }

  return "";
}

function getDayStateMessage(timeStatus, locked = false) {
  if (locked) return "Este dia já foi encerrado. Você pode visualizar as atividades, mas não pode alterá-las.";
  if (!timeStatus.availableMinutes) return "Pronto para alterações.";
  if (timeStatus.status === "error") return `Essa atividade ultrapassa o tempo disponível em ${formatMinutes(timeStatus.excessMinutes)}.`;
  if (timeStatus.status === "limit") return "Seu planejamento está no limite.";
  if (timeStatus.remainingMinutes > 0) return `Você ainda tem ${formatMinutes(timeStatus.remainingMinutes)} disponível.`;
  return "Seu dia está bem distribuído.";
}

function renderSelectedDateHeader() {
  const locked = isDateLocked(state.selectedDate);
  const dayActivities = getActivitiesByDate(state.selectedDate);
  const timeStatus = getDayTimeStatus(dayActivities, getEffectiveDaySettingsForDate(state.selectedDate));

  elements.selectedDateLabel.textContent = formatMyDayDate(state.selectedDate);
  elements.selectedDateStatus.textContent = locked
    ? "Este dia já foi encerrado. Você pode visualizar as atividades, mas não pode alterá-las."
    : "Pronto para alterações.";
  elements.lockedDayMessage.classList.remove("is-visible");

  renderMyDayCard(dayActivities, timeStatus, locked);
}

function renderMyDayCard(dayActivities, timeStatus, locked = false) {
  if (!elements.myDayActivities) return;

  const hasAnyDayData = dayActivities.length > 0 || Boolean(timeStatus.availableMinutes);
  elements.myDayActivities.textContent = hasAnyDayData ? `${dayActivities.length}` : "-";
  elements.myDayAvailable.textContent = timeStatus.availableMinutes ? formatMinutes(timeStatus.availableMinutes) : "-";
  elements.myDayPlanned.textContent = hasAnyDayData ? formatMinutes(timeStatus.plannedMinutes || 0) : "-";
  elements.myDayBalanceLabel.textContent = timeStatus.status === "error" ? "Excesso" : "Restante";
  elements.myDayBalance.textContent = timeStatus.status === "error" ? formatMinutes(timeStatus.excessMinutes) : (timeStatus.availableMinutes ? formatMinutes(timeStatus.remainingMinutes) : "-");
  elements.myDayMessage.textContent = getDayStateMessage(timeStatus, locked);
}

function updateSharingAvailability(hasActivities) {
  const sharingPanel = document.querySelector(".sharing-panel");
  const buttons = [elements.shareWhatsAppButton, elements.shareInstagramButton, elements.copySummaryButton, elements.nativeShareButton].filter(Boolean);

  sharingPanel?.classList.toggle("is-disabled", !hasActivities);
  buttons.forEach((button) => {
    button.disabled = !hasActivities;
    button.setAttribute("aria-disabled", String(!hasActivities));
  });
}

function renderDaySummary() {
  const dayActivities = getActivitiesByDate(state.selectedDate);
  const total = dayActivities.length;
  const completed = dayActivities.filter((activity) => activity.status === "completed").length;
  const pending = total - completed;
  const timeStatus = getDayTimeStatus(dayActivities, getEffectiveDaySettingsForDate(state.selectedDate));
  const hasAnyDayData = total > 0 || Boolean(timeStatus.availableMinutes);

  setCounterValue(elements.dayTotalActivities, total);
  setCounterValue(elements.dayPendingActivities, pending);
  setCounterValue(elements.dayCompletedActivities, completed);
  setCounterValue(elements.dayTotalTime, formatMinutes(timeStatus.plannedMinutes || 0));
  elements.activityListDescription.textContent = total
    ? `Gerencie as atividades de ${formatDateForHuman(state.selectedDate)}.`
    : "Você ainda não adicionou atividades para este dia.";

  elements.dayTimeStatusCard.closest(".day-summary-panel")?.classList.toggle("is-empty-day", !hasAnyDayData);
  renderTimeStatusCard(timeStatus);
  renderInstagramCard(timeStatus, dayActivities, completed, pending);
  updateSharingAvailability(total > 0);
}

document.addEventListener("DOMContentLoaded", () => {
  updateSharingAvailability(getActivitiesByDate(state.selectedDate).length > 0);
});

/* Calendário premium: mesma lógica, estrutura visual mais limpa. */
function formatMonthLabel(monthKey) {
  const { year, month } = parseMonthKey(monthKey);
  const date = new Date(Date.UTC(year, month - 1, 1, 12));
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function renderCalendar() {
  const { year, month } = parseMonthKey(state.visibleMonth);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = getTodayBrasiliaISO();
  const counts = createActivityCountByDate();
  const fragment = document.createDocumentFragment();

  elements.calendarGrid.innerHTML = "";
  elements.calendarGrid.classList.add("calendar__grid");
  elements.calendarMonthLabel.classList.add("calendar__month");
  elements.calendarMonthLabel.textContent = formatMonthLabel(state.visibleMonth);
  elements.calendarGrid.closest(".calendar-panel")?.classList.add("calendar");

  for (let index = 0; index < firstWeekday; index += 1) {
    const spacer = document.createElement("span");
    spacer.className = "calendar-day calendar__day calendar-day--empty calendar__day--empty";
    spacer.setAttribute("aria-hidden", "true");
    fragment.appendChild(spacer);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const activityCount = counts.get(dateString) || 0;
    const locked = isDateLocked(dateString);
    const selected = dateString === state.selectedDate;
    const isToday = dateString === today;
    const button = document.createElement("button");

    button.type = "button";
    button.className = "calendar-day calendar__day";
    button.dataset.date = dateString;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", `${formatDateForHuman(dateString)}${activityCount ? `, ${activityCount} atividade(s)` : ""}${locked ? ", dia encerrado" : ""}`);
    button.classList.toggle("is-selected", selected);
    button.classList.toggle("calendar__day--selected", selected);
    button.classList.toggle("is-today", isToday);
    button.classList.toggle("calendar__day--today", isToday);
    button.classList.toggle("has-activities", activityCount > 0);
    button.classList.toggle("calendar__day--has-activity", activityCount > 0);
    button.classList.toggle("is-locked", locked);
    button.classList.toggle("calendar__day--locked", locked);
    button.innerHTML = `<span>${day}</span>${activityCount ? `<small aria-hidden="true"></small>` : ""}`;
    fragment.appendChild(button);
  }

  elements.calendarGrid.appendChild(fragment);
}

/* Correção de estabilidade do calendário: faixa horizontal compacta, sem grade gigante. */
function renderCalendar() {
  const { year, month } = parseMonthKey(state.visibleMonth);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = getTodayBrasiliaISO();
  const counts = createActivityCountByDate();
  const weekLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const fragment = document.createDocumentFragment();

  elements.calendarGrid.innerHTML = "";
  elements.calendarGrid.className = "calendar-grid calendar-strip";
  elements.calendarMonthLabel.className = "calendar-month";
  elements.calendarMonthLabel.textContent = formatMonthLabel(state.visibleMonth);
  elements.calendarGrid.closest(".calendar-panel")?.classList.add("calendar-card");

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    const activityCount = counts.get(dateString) || 0;
    const locked = isDateLocked(dateString);
    const selected = dateString === state.selectedDate;
    const isToday = dateString === today;
    const button = document.createElement("button");

    button.type = "button";
    button.className = "calendar-day calendar-strip__day";
    button.dataset.date = dateString;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", `${formatDateForHuman(dateString)}${activityCount ? `, ${activityCount} atividade(s)` : ""}${locked ? ", dia encerrado" : ""}`);
    button.classList.toggle("is-selected", selected);
    button.classList.toggle("calendar-day--selected", selected);
    button.classList.toggle("is-today", isToday);
    button.classList.toggle("calendar-day--today", isToday);
    button.classList.toggle("has-activities", activityCount > 0);
    button.classList.toggle("calendar-day--has-activity", activityCount > 0);
    button.classList.toggle("is-locked", locked);
    button.classList.toggle("calendar-day--locked", locked);
    button.innerHTML = `
      <span class="calendar-day__number">${day}</span>
      <span class="calendar-day__week">${weekLabels[date.getUTCDay()]}</span>
      ${activityCount ? `<i class="calendar-day__dot" aria-hidden="true"></i>` : ""}`;
    fragment.appendChild(button);
  }

  elements.calendarGrid.appendChild(fragment);

  requestAnimationFrame(() => {
    const selectedDay = elements.calendarGrid.querySelector(".calendar-day--selected");
    selectedDay?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  });
}

/* Experiência focada: cadastro em painel e seções secundárias recolhíveis. */
(function initFocusedDayExperience() {
  function onReady(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback);
    else callback();
  }

  function createFormBackdrop() {
    let backdrop = document.querySelector("#formBackdrop");
    if (backdrop) return backdrop;

    backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.id = "formBackdrop";
    backdrop.className = "form-backdrop";
    backdrop.setAttribute("aria-label", "Fechar cadastro de atividade");
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function openActivityForm(options = {}) {
    const panel = document.querySelector(".form-panel");
    const dateInput = document.querySelector("#activityDate");
    const nameInput = document.querySelector("#activityName");

    if (!panel) return;
    if (dateInput && state?.selectedDate && !state.editingId) dateInput.value = state.selectedDate;

    document.body.classList.add("activity-form-open");
    panel.setAttribute("aria-hidden", "false");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "formTitle");

    if (options.focus !== false) {
      window.setTimeout(() => nameInput?.focus(), 80);
    }
  }

  function closeActivityForm() {
    const panel = document.querySelector(".form-panel");
    document.body.classList.remove("activity-form-open");
    panel?.setAttribute("aria-hidden", "true");
  }

  function prepareActivityFormPanel() {
    const panel = document.querySelector(".form-panel");
    const heading = panel?.querySelector(".section-heading");
    if (!panel || panel.dataset.focusPanelReady === "true") return;

    panel.dataset.focusPanelReady = "true";
    panel.setAttribute("aria-hidden", "true");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "sheet-close";
    closeButton.setAttribute("aria-label", "Fechar cadastro");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => {
      if (typeof resetFormMode === "function") resetFormMode();
      closeActivityForm();
    });

    heading?.appendChild(closeButton);
    createFormBackdrop().addEventListener("click", () => {
      if (typeof resetFormMode === "function") resetFormMode();
      closeActivityForm();
    });
  }

  function prepareOpenButtons() {
    const buttons = [
      document.querySelector(".my-day-card__action"),
      document.querySelector('.nav-actions .btn[href="#activities"]'),
      document.querySelector('.nav-actions .btn[href="#activityForm"]'),
    ].filter(Boolean);

    buttons.forEach((button) => {
      button.dataset.openActivityForm = "true";
      button.setAttribute("href", "#activityForm");
      button.textContent = "+ Nova atividade";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        openActivityForm();
      });
    });
  }

  function makeCollapsible(panel, title, description, options = {}) {
    if (!panel || panel.dataset.collapsibleReady === "true") return;

    const open = Boolean(options.open);
    const content = document.createElement("div");
    const toggle = document.createElement("button");
    const titleId = `${panel.id || title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-toggle`;

    content.className = "accordion-content";
    while (panel.firstChild) content.appendChild(panel.firstChild);

    toggle.type = "button";
    toggle.className = "accordion-toggle";
    toggle.id = titleId;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.innerHTML = `
      <span>
        <strong>${title}</strong>
        ${description ? `<small>${description}</small>` : ""}
      </span>
      <i aria-hidden="true">⌄</i>`;

    panel.dataset.collapsibleReady = "true";
    panel.classList.add("compact-accordion");
    panel.classList.toggle("is-open", open);
    panel.classList.toggle("is-collapsed", !open);
    panel.appendChild(toggle);
    panel.appendChild(content);

    toggle.addEventListener("click", () => {
      const nextOpen = !panel.classList.contains("is-open");
      panel.classList.toggle("is-open", nextOpen);
      panel.classList.toggle("is-collapsed", !nextOpen);
      toggle.setAttribute("aria-expanded", String(nextOpen));
    });
  }

  function prepareCollapsibleSections() {
    const timePanel = document.querySelector(".planning-panel:not(.suggestion-panel)");
    const calendarPanel = document.querySelector("#calendar");
    const assistantPanel = document.querySelector(".suggestion-panel");
    const dayDetailsPanel = document.querySelector(".day-summary-panel");
    const summaryPanel = document.querySelector("#summary");
    const sharingPanel = document.querySelector(".sharing-panel");

    makeCollapsible(timePanel, "Tempo disponível", "Ajuste o limite do dia", { open: false });
    makeCollapsible(calendarPanel, "Calendário", "Escolha outro dia", { open: false });
    makeCollapsible(assistantPanel, "Quer ajuda para organizar seu dia?", "Sugestão inteligente", { open: false });
    makeCollapsible(dayDetailsPanel, "Detalhes do dia", "Resumo e status completo", { open: false });
    makeCollapsible(summaryPanel, "Resumo geral", "Totais de todas as datas", { open: false });
    makeCollapsible(sharingPanel, "Compartilhamento", "Resumo compartilhável", { open: false });
  }

  function refreshFocusedState(hasActivities) {
    const activityPanel = document.querySelector("#activities");
    const sharingPanel = document.querySelector(".sharing-panel");
    const emptyText = sharingPanel?.querySelector("#instagramCardStatus");

    document.body.classList.toggle("has-day-activities", Boolean(hasActivities));
    activityPanel?.classList.toggle("has-activities", Boolean(hasActivities));
    sharingPanel?.classList.toggle("has-activities", Boolean(hasActivities));

    if (!hasActivities && emptyText) {
      emptyText.textContent = "Adicione atividades para gerar um resumo compartilhável.";
    }
  }

  onReady(() => {
    prepareActivityFormPanel();
    prepareOpenButtons();
    window.setTimeout(prepareCollapsibleSections, 0);
    refreshFocusedState(typeof getActivitiesByDate === "function" ? getActivitiesByDate(state.selectedDate).length > 0 : false);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("activity-form-open")) {
        closeActivityForm();
      }
    });
  });

  const originalStartEditActivity = typeof startEditActivity === "function" ? startEditActivity : null;
  if (originalStartEditActivity) {
    startEditActivity = function focusedStartEditActivity(activityId) {
      const result = originalStartEditActivity(activityId);
      openActivityForm({ focus: false });
      return result;
    };
  }

  const originalCreateActivity = typeof createActivity === "function" ? createActivity : null;
  if (originalCreateActivity) {
    createActivity = async function focusedCreateActivity(data, limitValidation = null) {
      const result = await originalCreateActivity(data, limitValidation);
      if (result) closeActivityForm();
      return result;
    };
  }

  const originalUpdateActivity = typeof updateActivity === "function" ? updateActivity : null;
  if (originalUpdateActivity) {
    updateActivity = async function focusedUpdateActivity(activityId, data, limitValidation = null) {
      const result = await originalUpdateActivity(activityId, data, limitValidation);
      if (result) closeActivityForm();
      return result;
    };
  }

  const originalUpdateSharingAvailability = typeof updateSharingAvailability === "function" ? updateSharingAvailability : null;
  if (originalUpdateSharingAvailability) {
    updateSharingAvailability = function focusedUpdateSharingAvailability(hasActivities) {
      originalUpdateSharingAvailability(hasActivities);
      refreshFocusedState(hasActivities);
    };
  }

  window.openActivityForm = openActivityForm;
  window.closeActivityForm = closeActivityForm;
})();

/* Mantém o resumo geral como informação secundária no fim do fluxo. */
document.addEventListener("DOMContentLoaded", () => {
  window.setTimeout(() => {
    const panels = document.querySelector(".main-panels");
    const summary = document.querySelector("#summary");
    if (panels && summary && summary.parentElement !== panels) {
      panels.appendChild(summary);
    }
  }, 20);
});

/* Cancelar edição também fecha o painel de cadastro focado. */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelector("#cancelEditButton")?.addEventListener("click", () => {
    window.setTimeout(() => window.closeActivityForm?.(), 0);
  });
});

/* Navegação por abas: mostra uma categoria por vez sem duplicar os componentes existentes. */
(function initTabbedSections() {
  const tabDefinitions = [
    {
      id: "planejamentos",
      label: "Planejamentos",
      selectors: [".planning-panel:not(.suggestion-panel)"],
    },
    {
      id: "atividades",
      label: "Atividades",
      selectors: [".workspace"],
    },
    {
      id: "inteligente",
      label: "Planejamento inteligente",
      selectors: [".suggestion-panel"],
    },
    {
      id: "compartilhamento",
      label: "Compartilhamento",
      selectors: [".sharing-panel"],
    },
    {
      id: "resumo",
      label: "Resumo do dia",
      selectors: [".day-summary-panel"],
    },
  ];

  function onReady(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback);
    else callback();
  }

  function getPanelContent(panel) {
    if (!panel) return null;
    panel.classList.add("tab-managed-section");
    panel.classList.remove("is-collapsed");
    panel.classList.add("is-open");
    panel.querySelector(".accordion-toggle")?.setAttribute("aria-expanded", "true");
    return panel;
  }

  function buildTabs(attempt = 0) {
    const mainPanels = document.querySelector(".main-panels");
    const calendar = document.querySelector("#calendar");

    if (!mainPanels || !calendar) return;

    const hasAllCorePanels = document.querySelector(".workspace")
      && document.querySelector(".planning-panel:not(.suggestion-panel)")
      && document.querySelector(".suggestion-panel")
      && document.querySelector(".day-summary-panel");

    if (!hasAllCorePanels && attempt < 10) {
      window.setTimeout(() => buildTabs(attempt + 1), 60);
      return;
    }

    if (document.querySelector(".tabs-section")) return;

    document.body.classList.add("tabs-mode");
    calendar.classList.add("dates-strip");
    calendar.classList.remove("is-collapsed");
    calendar.classList.add("is-open");
    calendar.querySelector(".accordion-toggle")?.setAttribute("aria-expanded", "true");

    const tabsSection = document.createElement("section");
    tabsSection.className = "tabs-section reveal is-visible";
    tabsSection.setAttribute("aria-label", "Categorias do planejamento");

    const tabsNav = document.createElement("div");
    tabsNav.className = "tabs-nav";
    tabsNav.setAttribute("role", "tablist");
    tabsNav.setAttribute("aria-label", "Navegar pelas categorias");

    const tabsContent = document.createElement("div");
    tabsContent.className = "tabs-content";

    tabDefinitions.forEach((tab, index) => {
      const tabId = `tab-${tab.id}`;
      const panelId = `tab-panel-${tab.id}`;
      const isActive = index === 0;
      const button = document.createElement("button");
      const panel = document.createElement("section");

      button.type = "button";
      button.id = tabId;
      button.className = `tab-btn${isActive ? " is-active" : ""}`;
      button.dataset.tab = tab.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("aria-controls", panelId);
      button.setAttribute("tabindex", isActive ? "0" : "-1");
      button.textContent = tab.label;

      panel.id = panelId;
      panel.className = `tab-panel${isActive ? " is-active" : ""}`;
      panel.dataset.tabPanel = tab.id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
      if (!isActive) panel.hidden = true;

      tab.selectors.forEach((selector) => {
        const content = getPanelContent(document.querySelector(selector));
        if (content) panel.appendChild(content);
      });

      if (!panel.children.length) {
        const empty = document.createElement("div");
        empty.className = "tab-empty-state";
        empty.textContent = "Nada para mostrar nesta categoria agora.";
        panel.appendChild(empty);
      }

      tabsNav.appendChild(button);
      tabsContent.appendChild(panel);
    });

    tabsSection.appendChild(tabsNav);
    tabsSection.appendChild(tabsContent);
    calendar.insertAdjacentElement("afterend", tabsSection);

    const summary = document.querySelector("#summary");
    if (summary) summary.classList.add("tabs-hidden-summary");

    bindTabs(tabsSection);
  }

  function activateTab(tabsSection, tabId, options = {}) {
    const tabs = [...tabsSection.querySelectorAll('[role="tab"]')];
    const panels = [...tabsSection.querySelectorAll('[role="tabpanel"]')];
    const nextTab = tabs.find((tab) => tab.dataset.tab === tabId) || tabs[0];
    if (!nextTab) return;

    tabs.forEach((tab) => {
      const active = tab === nextTab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    });

    panels.forEach((panel) => {
      const active = panel.dataset.tabPanel === nextTab.dataset.tab;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });

    if (options.focus) nextTab.focus();
  }

  function bindTabs(tabsSection) {
    const tabsNav = tabsSection.querySelector(".tabs-nav");

    tabsNav?.addEventListener("click", (event) => {
      const button = event.target.closest(".tab-btn");
      if (!button) return;
      activateTab(tabsSection, button.dataset.tab);
    });

    tabsNav?.addEventListener("keydown", (event) => {
      const tabs = [...tabsSection.querySelectorAll('[role="tab"]')];
      const currentIndex = tabs.indexOf(document.activeElement);
      if (currentIndex < 0) return;

      const keyMap = {
        ArrowRight: 1,
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1,
      };

      if (!(event.key in keyMap)) return;
      event.preventDefault();
      const nextIndex = (currentIndex + keyMap[event.key] + tabs.length) % tabs.length;
      activateTab(tabsSection, tabs[nextIndex].dataset.tab, { focus: true });
    });

    document.querySelectorAll('a[href="#activityForm"], .my-day-card__action').forEach((link) => {
      link.addEventListener("click", () => activateTab(tabsSection, "atividades"));
    });
  }

  onReady(() => window.setTimeout(() => buildTabs(), 140));

  const previousCreateActivity = typeof createActivity === "function" ? createActivity : null;
  if (previousCreateActivity) {
    createActivity = async function tabbedCreateActivity(data, limitValidation = null) {
      const result = await previousCreateActivity(data, limitValidation);
      if (result) {
        const tabsSection = document.querySelector(".tabs-section");
        if (tabsSection) activateTab(tabsSection, "atividades");
      }
      return result;
    };
  }
})();

/* Ajuste definitivo das abas: rótulos curtos, datas centralizadas e uma seção por vez. */
(function refineDefinitiveTabs() {
  const labelMap = {
    planejamentos: "Planejamentos",
    atividades: "Atividades",
    inteligente: "Inteligente",
    compartilhamento: "Compartilhar",
    compartilhar: "Compartilhar",
    resumo: "Resumo",
  };

  function refineTabs(attempt = 0) {
    const tabsSection = document.querySelector(".tabs-section");
    if (!tabsSection) {
      if (attempt < 20) window.setTimeout(() => refineTabs(attempt + 1), 80);
      return;
    }

    tabsSection.classList.add("tabs-section--definitive");

    tabsSection.querySelectorAll(".tab-btn").forEach((button) => {
      const nextLabel = labelMap[button.dataset.tab];
      if (nextLabel) button.textContent = nextLabel;
      button.setAttribute("aria-label", `Abrir aba ${button.textContent.trim()}`);
    });

    tabsSection.querySelectorAll(".tab-panel").forEach((panel) => {
      const active = panel.classList.contains("is-active");
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", String(!active));
    });

    const calendar = document.querySelector("#calendar");
    calendar?.classList.add("dates-strip--centered");
  }

  document.addEventListener("DOMContentLoaded", () => refineTabs());
})();

/* Garante que o painel de compartilhamento fique dentro da aba correta. */
(function ensureSharingTabContent() {
  function repair(attempt = 0) {
    const sharingPanel = document.querySelector(".sharing-panel");
    const tabPanel = document.querySelector('#tab-panel-compartilhamento, #tab-panel-compartilhar');

    if (sharingPanel && tabPanel && !tabPanel.contains(sharingPanel)) {
      tabPanel.querySelector(".tab-empty-state")?.remove();
      sharingPanel.classList.add("tab-managed-section", "is-open");
      sharingPanel.classList.remove("is-collapsed");
      sharingPanel.querySelector(".accordion-toggle")?.setAttribute("aria-expanded", "true");
      tabPanel.appendChild(sharingPanel);
    }

    if ((!sharingPanel || !tabPanel) && attempt < 20) {
      window.setTimeout(() => repair(attempt + 1), 80);
    }
  }

  document.addEventListener("DOMContentLoaded", () => window.setTimeout(() => repair(), 180));
})();

/* Ordem final: Meu dia -> datas -> abas -> conteúdo, preservando a aba ativa ao trocar a data. */
(function enforceDateSelectorBeforeTabs() {
  function getActiveTabId() {
    return document.querySelector('.tabs-section .tab-btn.is-active')?.dataset.tab || "planejamentos";
  }

  function setActiveTab(tabId) {
    const tabsSection = document.querySelector(".tabs-section");
    if (!tabsSection) return;

    const tabs = [...tabsSection.querySelectorAll('[role="tab"]')];
    const panels = [...tabsSection.querySelectorAll('[role="tabpanel"]')];
    const nextTab = tabs.find((tab) => tab.dataset.tab === tabId) || tabs[0];
    if (!nextTab) return;

    tabs.forEach((tab) => {
      const active = tab === nextTab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    });

    panels.forEach((panel) => {
      const active = panel.dataset.tabPanel === nextTab.dataset.tab;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", String(!active));
    });
  }

  function enforceOrder() {
    const mainPanels = document.querySelector(".main-panels");
    const calendar = document.querySelector("#calendar");
    const tabsSection = document.querySelector(".tabs-section");

    if (!mainPanels || !calendar || !tabsSection) return;

    calendar.classList.add("date-selector", "dates-strip", "dates-strip--centered");
    tabsSection.classList.add("tabs-section--after-dates", "tabs-section--definitive");

    if (calendar.parentElement !== mainPanels) {
      mainPanels.insertBefore(calendar, mainPanels.firstElementChild);
    }

    if (tabsSection.previousElementSibling !== calendar) {
      calendar.insertAdjacentElement("afterend", tabsSection);
    }
  }

  function refreshLayoutAfterDateChange(activeTabId = getActiveTabId()) {
    window.requestAnimationFrame(() => {
      enforceOrder();
      setActiveTab(activeTabId);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    window.setTimeout(() => refreshLayoutAfterDateChange(), 240);
  });

  const previousSelectDate = typeof selectDate === "function" ? selectDate : null;
  if (previousSelectDate) {
    selectDate = function orderedSelectDate(dateString, options = {}) {
      const activeTabId = getActiveTabId();
      const result = previousSelectDate(dateString, options);
      refreshLayoutAfterDateChange(activeTabId);
      return result;
    };
  }

  const previousRenderApp = typeof renderApp === "function" ? renderApp : null;
  if (previousRenderApp) {
    renderApp = function orderedRenderApp() {
      const activeTabId = getActiveTabId();
      const result = previousRenderApp();
      refreshLayoutAfterDateChange(activeTabId);
      return result;
    };
  }
})();

/* Sequência definitiva das abas: Planejamento, Cadastro, Atividades, Inteligente, Compartilhar, Resumo. */
(function initFinalActivityTabsOrder() {
  const finalTabs = [
    { id: "planejamento", label: "Planejamento", selector: ".planning-panel:not(.suggestion-panel)" },
    { id: "cadastro", label: "Cadastro de atividades", selector: ".form-panel" },
    { id: "minhas-atividades", label: "Minhas atividades", selector: "#activities" },
    { id: "inteligente", label: "Inteligente", selector: ".suggestion-panel" },
    { id: "compartilhar", label: "Compartilhar", selector: ".sharing-panel" },
    { id: "resumo", label: "Resumo", selector: ".day-summary-panel" },
  ];

  function getCurrentTab() {
    const active = document.querySelector(".tabs-section .tab-btn.is-active")?.dataset.tab;
    if (active === "atividades") return "minhas-atividades";
    if (active === "planejamentos") return "planejamento";
    if (active === "compartilhamento") return "compartilhar";
    return active || "planejamento";
  }

  function activateFinalTab(tabId, options = {}) {
    const tabsSection = document.querySelector(".tabs-section");
    if (!tabsSection) return;

    const tabs = [...tabsSection.querySelectorAll('[role="tab"]')];
    const panels = [...tabsSection.querySelectorAll('[role="tabpanel"]')];
    const nextTab = tabs.find((tab) => tab.dataset.tab === tabId) || tabs[0];
    if (!nextTab) return;

    tabs.forEach((tab) => {
      const active = tab === nextTab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    });

    panels.forEach((panel) => {
      const active = panel.dataset.tabPanel === nextTab.dataset.tab;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", String(!active));
    });

    if (options.focus) nextTab.focus();
  }

  function preparePanelElement(element, tabId) {
    if (!element) return null;

    element.classList.add("tab-managed-section", `tab-managed-section--${tabId}`);
    element.classList.remove("is-collapsed");
    element.classList.add("is-open");
    element.querySelector(".accordion-toggle")?.setAttribute("aria-expanded", "true");

    if (element.classList.contains("form-panel")) {
      element.setAttribute("aria-hidden", "false");
      element.removeAttribute("aria-modal");
      element.removeAttribute("role");
    }

    return element;
  }

  function rebuildTabs(attempt = 0) {
    const tabsSection = document.querySelector(".tabs-section");
    const calendar = document.querySelector("#calendar");
    const mainPanels = document.querySelector(".main-panels");

    if (!tabsSection || !calendar || !mainPanels) {
      if (attempt < 30) window.setTimeout(() => rebuildTabs(attempt + 1), 80);
      return;
    }

    const collected = finalTabs.map((tab) => ({ ...tab, element: document.querySelector(tab.selector) }));
    const missingCore = collected.some((tab) => tab.id !== "compartilhar" && !tab.element);
    if (missingCore && attempt < 30) {
      window.setTimeout(() => rebuildTabs(attempt + 1), 80);
      return;
    }

    const activeBefore = getCurrentTab();
    const storage = document.createDocumentFragment();
    collected.forEach((tab) => {
      if (tab.element) storage.appendChild(tab.element);
    });

    let tabsNav = tabsSection.querySelector(".tabs-nav");
    let tabsContent = tabsSection.querySelector(".tabs-content");

    if (!tabsNav) {
      tabsNav = document.createElement("div");
      tabsNav.className = "tabs-nav";
      tabsNav.setAttribute("role", "tablist");
      tabsSection.prepend(tabsNav);
    }

    if (!tabsContent) {
      tabsContent = document.createElement("div");
      tabsContent.className = "tabs-content";
      tabsSection.appendChild(tabsContent);
    }

    tabsNav.replaceChildren();
    tabsContent.replaceChildren();

    tabsSection.classList.add("tabs-section--final-order", "tabs-section--definitive", "tabs-section--after-dates");
    tabsNav.setAttribute("role", "tablist");
    tabsNav.setAttribute("aria-label", "Menu de seções do dia");

    collected.forEach((tab, index) => {
      const button = document.createElement("button");
      const panel = document.createElement("section");
      const active = tab.id === activeBefore || (!finalTabs.some((item) => item.id === activeBefore) && index === 0);
      const tabId = `tab-${tab.id}`;
      const panelId = `tab-panel-${tab.id}`;

      button.type = "button";
      button.id = tabId;
      button.className = `tab-btn${active ? " is-active" : ""}`;
      button.dataset.tab = tab.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(active));
      button.setAttribute("aria-controls", panelId);
      button.setAttribute("tabindex", active ? "0" : "-1");
      button.textContent = tab.label;

      panel.id = panelId;
      panel.className = `tab-panel tab-panel--${tab.id}${active ? " is-active" : ""}`;
      panel.dataset.tabPanel = tab.id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", String(!active));

      const element = preparePanelElement(tab.element, tab.id);
      if (element) {
        panel.appendChild(element);
      } else {
        const empty = document.createElement("div");
        empty.className = "tab-empty-state";
        empty.textContent = tab.id === "compartilhar"
          ? "Adicione atividades para gerar um resumo compartilhável."
          : "Nada para mostrar nesta seção agora.";
        panel.appendChild(empty);
      }

      tabsNav.appendChild(button);
      tabsContent.appendChild(panel);
    });

    calendar.classList.add("date-selector", "dates-strip", "dates-strip--centered");
    if (calendar.parentElement !== mainPanels) mainPanels.insertBefore(calendar, mainPanels.firstElementChild);
    if (tabsSection.previousElementSibling !== calendar) calendar.insertAdjacentElement("afterend", tabsSection);

    activateFinalTab(activeBefore);
  }

  function bindFinalTabs() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest(".tabs-section--final-order .tab-btn");
      if (!button) return;
      activateFinalTab(button.dataset.tab);
    });

    document.addEventListener("keydown", (event) => {
      const tabsSection = document.querySelector(".tabs-section--final-order");
      if (!tabsSection || !event.target.matches('[role="tab"]')) return;
      if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;

      const tabs = [...tabsSection.querySelectorAll('[role="tab"]')];
      const currentIndex = tabs.indexOf(event.target);
      if (currentIndex < 0) return;

      event.preventDefault();
      const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
      const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length];
      activateFinalTab(nextTab.dataset.tab, { focus: true });
    });

    document.addEventListener("click", (event) => {
      const opener = event.target.closest('.my-day-card__action, .nav-actions .btn[href="#activityForm"], .nav-actions .btn[href="#activities"]');
      if (!opener) return;
      event.preventDefault();
      event.stopPropagation();
      document.body.classList.remove("activity-form-open");
      activateFinalTab("cadastro");
      window.setTimeout(() => document.querySelector("#activityName")?.focus(), 80);
    }, true);
  }

  document.addEventListener("DOMContentLoaded", () => {
    window.setTimeout(rebuildTabs, 360);
    bindFinalTabs();
  });

  const previousSelectDate = typeof selectDate === "function" ? selectDate : null;
  if (previousSelectDate) {
    selectDate = function finalTabsSelectDate(dateString, options = {}) {
      const active = getCurrentTab();
      const result = previousSelectDate(dateString, options);
      window.requestAnimationFrame(() => {
        rebuildTabs();
        activateFinalTab(active);
      });
      return result;
    };
  }

  const previousRenderApp = typeof renderApp === "function" ? renderApp : null;
  if (previousRenderApp) {
    renderApp = function finalTabsRenderApp() {
      const active = getCurrentTab();
      const result = previousRenderApp();
      window.requestAnimationFrame(() => {
        rebuildTabs();
        activateFinalTab(active);
      });
      return result;
    };
  }

  const previousStartEditActivity = typeof startEditActivity === "function" ? startEditActivity : null;
  if (previousStartEditActivity) {
    startEditActivity = function finalTabsStartEditActivity(activityId) {
      const result = previousStartEditActivity(activityId);
      document.body.classList.remove("activity-form-open");
      window.requestAnimationFrame(() => {
        rebuildTabs();
        activateFinalTab("cadastro");
      });
      return result;
    };
  }

  const previousCreateActivity = typeof createActivity === "function" ? createActivity : null;
  if (previousCreateActivity) {
    createActivity = async function finalTabsCreateActivity(data, limitValidation = null) {
      const result = await previousCreateActivity(data, limitValidation);
      if (result) {
        document.body.classList.remove("activity-form-open");
        window.requestAnimationFrame(() => {
          rebuildTabs();
          activateFinalTab("minhas-atividades");
        });
      }
      return result;
    };
  }
})();

/* Mantém o formulário acessível dentro da aba de cadastro após cancelar edição. */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelector("#cancelEditButton")?.addEventListener("click", () => {
    window.setTimeout(() => {
      const formPanel = document.querySelector("#tab-panel-cadastro .form-panel");
      if (formPanel) {
        formPanel.setAttribute("aria-hidden", "false");
        formPanel.removeAttribute("aria-modal");
        formPanel.removeAttribute("role");
        document.body.classList.remove("activity-form-open");
      }
    }, 20);
  });
});
