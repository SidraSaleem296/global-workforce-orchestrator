const AUDIT_PANEL_STORAGE_KEY = "ghwo.auditTrailCollapsed";

const readAuditPanelCollapsedState = () => {
  try {
    return window.localStorage.getItem(AUDIT_PANEL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const state = {
  workspace: null,
  meta: null,
  pollHandle: null,
  taskFilter: "all",
  auditTrailCollapsed: readAuditPanelCollapsedState(),
  auditChatMessages: [
    {
      role: "assistant",
      content: "Ask me what changed in Notion, why a task needed approval, or summarize recent audit activity.",
    },
  ],
};

const selectors = {
  messageBanner: document.querySelector("#message-banner"),
  refreshButton: document.querySelector("#refresh-button"),
  createTaskForm: document.querySelector("#create-task-form"),
  taskList: document.querySelector("#task-list"),
  approvalList: document.querySelector("#approval-list"),
  workerList: document.querySelector("#worker-list"),
  logList: document.querySelector("#log-list"),
  taskTemplate: document.querySelector("#task-card-template"),
  approvalTemplate: document.querySelector("#approval-card-template"),
  tasksEmpty: document.querySelector("#tasks-empty"),
  approvalsEmpty: document.querySelector("#approvals-empty"),
  taskFilterBar: document.querySelector("#task-filter-bar"),
  taskFilterNote: document.querySelector("#task-filter-note"),
  connectionStatus: document.querySelector("#connection-status"),
  metaProvider: document.querySelector("#meta-provider"),
  metaModel: document.querySelector("#meta-model"),
  metaThreshold: document.querySelector("#meta-threshold"),
  totalTasks: document.querySelector("#stat-total-tasks"),
  assignedTasks: document.querySelector("#stat-assigned-tasks"),
  pendingApprovals: document.querySelector("#stat-pending-approvals"),
  averageConfidence: document.querySelector("#stat-average-confidence"),
  auditChatThread: document.querySelector("#audit-chat-thread"),
  auditChatForm: document.querySelector("#audit-chat-form"),
  auditChatInput: document.querySelector("#audit-chat-input"),
  auditSuggestions: document.querySelector("#audit-suggestions"),
  auditPanel: document.querySelector("#audit-panel"),
  auditToggle: document.querySelector("#audit-toggle"),
  auditLogRegion: document.querySelector("#audit-log-region"),
};

const formatNumber = (value, digits = 0) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

const formatDate = (value) => {
  if (!value) {
    return "No timestamp";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const parseJson = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const escapeHtml = (value = "") =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

const formatInlineMarkup = (value = "") => {
  let safeValue = escapeHtml(value);
  safeValue = safeValue.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safeValue = safeValue.replace(/`([^`]+)`/g, "<code>$1</code>");
  return safeValue;
};

const renderMessageMarkup = (content = "") => {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push(`<ul>${listItems.map((item) => `<li>${formatInlineMarkup(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      flushList();
      return;
    }

    if (/^-\s+/.test(trimmedLine)) {
      listItems.push(trimmedLine.replace(/^-\s+/, ""));
      return;
    }

    flushList();
    blocks.push(`<p>${formatInlineMarkup(trimmedLine)}</p>`);
  });

  flushList();

  return blocks.join("");
};

const toStatusClass = (value = "") => {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("pending")) {
    return "pending";
  }

  if (normalized.includes("completed") || normalized.includes("approved")) {
    return "completed";
  }

  if (normalized.includes("reject")) {
    return "rejected";
  }

  return "";
};

const normalizeStatus = (value = "") => value.trim().toLowerCase();
const isPendingApproval = (approval) => ["pending", "awaiting approval", "needs approval"].includes(normalizeStatus(approval.status));

const extractRecommendedWorkerName = (value = "") => {
  const match = value.match(/Selected\s+(.+?)\s+for\s+"/i);
  return match?.[1]?.trim() || null;
};

const doesLogRelateToTask = (log, task) => {
  if (!log || !task) {
    return false;
  }

  if (log.entityId === task.id || log.entityId === task.pageId) {
    return true;
  }

  const payload = parseJson(log.payload);

  if (payload?.taskId === task.id || payload?.taskId === task.pageId || payload?.task?.id === task.id) {
    return true;
  }

  return typeof log.message === "string" && log.message.toLowerCase().includes(`"${task.title.toLowerCase()}"`);
};

const getTaskRelatedLogs = (task) =>
  (state.workspace?.logs || []).filter((log) => doesLogRelateToTask(log, task));

const buildTaskStory = (task) => {
  const effectiveStatus = getEffectiveTaskStatus(task);
  const relatedLogs = getTaskRelatedLogs(task);
  const latestApprovalDecision = relatedLogs.find((log) => log.eventType === "APPROVAL_DECIDED");
  const latestApprovalRequest = relatedLogs.find((log) => log.eventType === "APPROVAL_REQUESTED");
  const approvalDecisionPayload = parseJson(latestApprovalDecision?.payload) || {};
  const approvalRequestPayload = parseJson(latestApprovalRequest?.payload) || {};
  const suggestedWorker = approvalDecisionPayload.workerName
    || approvalRequestPayload.candidateWorkerName
    || extractRecommendedWorkerName(task.selectionReason)
    || task.assignedWorkerName
    || "the suggested worker";

  if (effectiveStatus === "rejected") {
    const storyParts = [
      `${approvalDecisionPayload.reviewer || "A reviewer"} rejected the recommendation for ${suggestedWorker}${latestApprovalDecision?.timestamp ? ` on ${formatDate(latestApprovalDecision.timestamp)}` : ""}.`,
      "The task has been reopened and is ready for a fresh assignment run.",
    ];

    if (approvalDecisionPayload.notes) {
      storyParts.push(`Decision notes: ${approvalDecisionPayload.notes}`);
    }

    if (task.selectionReason) {
      storyParts.push(task.selectionReason.includes("Original AI recommendation:")
        ? task.selectionReason
        : `Original AI recommendation: ${task.selectionReason}`);
    }

    return {
      label: "Task Story",
      text: storyParts.join("\n\n"),
    };
  }

  if (effectiveStatus === "pending approval") {
    const storyParts = [
      `The AI recommended ${suggestedWorker}, but confidence was low so this task is waiting for human approval.`,
    ];

    if (task.selectionReason) {
      storyParts.push(`Recommendation details: ${task.selectionReason}`);
    }

    return {
      label: "Approval Story",
      text: storyParts.join("\n\n"),
    };
  }

  if (effectiveStatus === "assigned" && normalizeStatus(task.approvalStatus) === "approved" && latestApprovalDecision) {
    const storyParts = [
      `${approvalDecisionPayload.reviewer || "A reviewer"} approved assigning ${task.assignedWorkerName || suggestedWorker} to this task${latestApprovalDecision?.timestamp ? ` on ${formatDate(latestApprovalDecision.timestamp)}` : ""}.`,
    ];

    if (approvalDecisionPayload.notes) {
      storyParts.push(`Decision notes: ${approvalDecisionPayload.notes}`);
    }

    if (task.selectionReason) {
      storyParts.push(task.selectionReason);
    }

    return {
      label: "Task Story",
      text: storyParts.join("\n\n"),
    };
  }

  return {
    label: task.approvalStatus && normalizeStatus(task.approvalStatus) !== "not required" ? "Workflow Story" : "AI Reasoning",
    text: task.selectionReason || "",
  };
};

const getEffectiveTaskStatus = (task) => {
  const rawStatus = normalizeStatus(task.status);
  const approvalStatus = normalizeStatus(task.approvalStatus);

  if (
    task.completedAt
    || ["completed", "done", "closed", "delivered", "finished"].includes(rawStatus)
  ) {
    return "completed";
  }

  if (
    task.humanApprovalNeeded
    || ["pending", "awaiting approval", "needs approval"].includes(approvalStatus)
    || ["pending approval", "awaiting approval", "needs approval"].includes(rawStatus)
  ) {
    return "pending approval";
  }

  if (["rejected", "declined", "blocked"].includes(rawStatus) || ["rejected", "declined"].includes(approvalStatus)) {
    return "rejected";
  }

  if (
    task.assignedWorkerName
    || task.assignedWorkerId
    || ["assigned", "in progress", "active", "working"].includes(rawStatus)
  ) {
    return "assigned";
  }

  return "open";
};

const getDisplayTaskStatus = (task) => {
  const effectiveStatus = getEffectiveTaskStatus(task);

  if (effectiveStatus === "pending approval") {
    return "Pending Approval";
  }

  if (effectiveStatus === "assigned") {
    return "Assigned";
  }

  if (effectiveStatus === "completed") {
    return "Completed";
  }

  if (effectiveStatus === "rejected") {
    return "Rejected";
  }

  return task.status || "Open";
};

const truncateText = (value, maxLength = 150) => {
  if (!value) {
    return "No description provided.";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trim()}...` : value;
};

const getPriorityClass = (value = "") => {
  const normalized = value.trim().toLowerCase();

  if (normalized === "high") {
    return "priority-high";
  }

  if (normalized === "low") {
    return "priority-low";
  }

  return "priority-medium";
};

const matchesTaskFilter = (task) => {
  const normalizedStatus = getEffectiveTaskStatus(task);

  if (state.taskFilter === "assigned") {
    return normalizedStatus === "assigned";
  }

  if (state.taskFilter === "completed") {
    return normalizedStatus === "completed";
  }

  if (state.taskFilter === "action") {
    return ["open", "pending approval", "rejected"].includes(normalizedStatus);
  }

  return true;
};

const getTaskFilterLabel = (count, total) => {
  if (state.taskFilter === "action") {
    return `Showing ${count} action-needed task${count === 1 ? "" : "s"} of ${total}`;
  }

  if (state.taskFilter === "assigned") {
    return `Showing ${count} assigned task${count === 1 ? "" : "s"} of ${total}`;
  }

  if (state.taskFilter === "completed") {
    return `Showing ${count} completed task${count === 1 ? "" : "s"} of ${total}`;
  }

  return `Showing all ${count} task${count === 1 ? "" : "s"}`;
};

const applyStatusClass = (element, value) => {
  const statusClass = toStatusClass(value);
  const baseClass = element.dataset.baseClass || element.className;
  element.dataset.baseClass = baseClass;
  element.className = [baseClass, statusClass].filter(Boolean).join(" ");
};

const showMessage = (text, type = "success") => {
  selectors.messageBanner.textContent = text;
  selectors.messageBanner.className = `message ${type === "error" ? "is-error" : "is-success"}`;

  window.clearTimeout(showMessage.timeoutId);
  showMessage.timeoutId = window.setTimeout(() => {
    selectors.messageBanner.className = "message hidden";
  }, 4200);
};

const summarizeNonJsonResponse = (text) => {
  const compactText = (text || "").replace(/\s+/g, " ").trim();
  const titleMatch = compactText.match(/<title>([^<]+)<\/title>/i);

  if (titleMatch?.[1]) {
    return titleMatch[1];
  }

  if (compactText.startsWith("<!DOCTYPE") || compactText.startsWith("<html")) {
    return "The server returned HTML instead of JSON.";
  }

  return compactText.slice(0, 180);
};

const readJsonResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    const text = await response.text();
    throw new Error(summarizeNonJsonResponse(text) || "The server did not return JSON.");
  }

  return response.json();
};

const handleApiError = async (response) => {
  let payload = {};

  try {
    payload = await readJsonResponse(response);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `Request failed with status ${response.status}.`);
  }

  const message = payload.error || `Request failed with status ${response.status}.`;
  throw new Error(message);
};

const request = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    await handleApiError(response);
  }

  return readJsonResponse(response);
};

const setLoadingState = (button, isLoading, label) => {
  if (!button) {
    return;
  }

  if (isLoading) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
    return;
  }

  button.textContent = button.dataset.originalLabel || button.textContent;
  button.disabled = false;
};

const renderMeta = () => {
  if (!state.meta) {
    return;
  }

  selectors.connectionStatus.textContent = "Live";
  selectors.metaProvider.textContent = state.meta.aiProvider || "-";
  selectors.metaModel.textContent = state.meta.aiModel || "-";
  selectors.metaThreshold.textContent = state.meta.confidenceThreshold ?? "-";
};

const renderStats = () => {
  const stats = state.workspace?.stats;

  if (!stats) {
    return;
  }

  selectors.totalTasks.textContent = formatNumber(stats.totalTasks);
  selectors.assignedTasks.textContent = formatNumber(stats.assignedTasks);
  selectors.pendingApprovals.textContent = formatNumber(stats.pendingApprovals);
  selectors.averageConfidence.textContent = stats.averageConfidence ? `${formatNumber(stats.averageConfidence, 2)}` : "0.00";
};

const renderTasks = () => {
  const tasks = state.workspace?.tasks || [];
  const visibleTasks = tasks.filter(matchesTaskFilter);
  selectors.taskList.innerHTML = "";
  selectors.taskFilterNote.textContent = getTaskFilterLabel(visibleTasks.length, tasks.length);
  selectors.tasksEmpty.textContent = tasks.length === 0
    ? "No tasks yet. Create one to start the demo."
    : "No tasks match the current filter.";
  selectors.tasksEmpty.classList.toggle("hidden", visibleTasks.length !== 0);

  selectors.taskFilterBar.querySelectorAll(".filter-pill").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.taskFilter);
  });

  visibleTasks.forEach((task) => {
    const fragment = selectors.taskTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".task-card");
    const statusChip = fragment.querySelector(".task-status");
    const confidenceChip = fragment.querySelector(".confidence-chip");
    const title = fragment.querySelector(".task-title");
    const priorityPill = fragment.querySelector(".task-priority-pill");
    const description = fragment.querySelector(".task-description");
    const skill = fragment.querySelector(".detail-skill");
    const worker = fragment.querySelector(".detail-worker");
    const approval = fragment.querySelector(".detail-approval");
    const updated = fragment.querySelector(".detail-updated");
    const reasoning = fragment.querySelector(".reasoning");
    const assignButton = fragment.querySelector(".action-assign");
    const completeToggle = fragment.querySelector(".action-complete-toggle");
    const detailsToggle = fragment.querySelector(".action-details-toggle");
    const notionLink = fragment.querySelector(".action-notion");
    const detailsSection = fragment.querySelector(".task-details");
    const detailPriority = fragment.querySelector(".detail-priority");
    const detailConfidence = fragment.querySelector(".detail-confidence");
    const detailCompletedAt = fragment.querySelector(".detail-completed-at");
    const detailQuality = fragment.querySelector(".detail-quality");
    const storyLabel = fragment.querySelector(".detail-story-label");
    const completeForm = fragment.querySelector(".complete-form");
    const completionTextarea = completeForm.querySelector("textarea");
    const priorityValue = task.priority || "Medium";
    const updatedValue = task.lastEditedAt || task.completedAt || task.createdAt;
    const effectiveStatus = getEffectiveTaskStatus(task);
    const taskStory = buildTaskStory(task);

    card.dataset.taskId = task.id;
    statusChip.textContent = getDisplayTaskStatus(task);
    applyStatusClass(statusChip, effectiveStatus);
    confidenceChip.textContent = task.aiConfidence !== undefined ? `Confidence ${formatNumber(task.aiConfidence, 2)}` : "Not scored";
    title.textContent = task.title;
    priorityPill.textContent = priorityValue;
    priorityPill.className = `task-priority-pill ${getPriorityClass(priorityValue)}`;
    description.textContent = truncateText(task.description);
    skill.textContent = task.requiredSkill || "Generalist";
    worker.textContent = task.assignedWorkerName || "Unassigned";
    approval.textContent = task.approvalStatus || "Not Required";
    updated.textContent = updatedValue ? formatDate(updatedValue) : "No updates yet";
    detailPriority.textContent = `Priority ${priorityValue}`;
    detailConfidence.textContent = task.aiConfidence !== undefined ? `Confidence ${formatNumber(task.aiConfidence, 2)}` : "Confidence N/A";

    storyLabel.textContent = taskStory.label;

    if (taskStory.text) {
      reasoning.classList.remove("hidden");
      reasoning.textContent = taskStory.text;
    } else {
      reasoning.classList.add("hidden");
      reasoning.textContent = "";
    }

    if (task.completedAt) {
      detailCompletedAt.classList.remove("hidden");
      detailCompletedAt.textContent = `Completed ${formatDate(task.completedAt)}`;
    }

    if (typeof task.qualityScore === "number") {
      detailQuality.classList.remove("hidden");
      detailQuality.textContent = `Quality ${formatNumber(task.qualityScore)}`;
    }

    notionLink.href = task.notionUrl || "#";
    notionLink.classList.toggle("hidden", !task.notionUrl);

    const canAssign = !["completed", "assigned", "pending approval"].includes(effectiveStatus);
    const canComplete = effectiveStatus === "assigned";
    const hasDetails = Boolean(taskStory.text || task.completedAt || typeof task.qualityScore === "number" || canComplete);

    const toggleDetails = (forceOpen = null) => {
      const shouldOpen = forceOpen ?? detailsSection.classList.contains("hidden");
      detailsSection.classList.toggle("hidden", !shouldOpen);
      detailsToggle.textContent = shouldOpen ? "Hide Details" : "Details";
    };

    assignButton.disabled = !canAssign;
    if (!canAssign) {
      assignButton.textContent = effectiveStatus === "pending approval"
        ? "Awaiting Approval"
        : effectiveStatus === "completed"
          ? "Completed"
          : "Assignment Locked";
    }

    completeToggle.classList.toggle("hidden", !canComplete);
    detailsToggle.classList.toggle("hidden", !hasDetails);
    completeForm.classList.toggle("hidden", true);

    assignButton.addEventListener("click", async () => {
      try {
        setLoadingState(assignButton, true, "Assigning...");
        const result = await request("/api/task/assign", {
          method: "POST",
          body: JSON.stringify({ taskId: task.id }),
        });
        showMessage(
          result.status === "pending_approval"
            ? result.reusedExistingApproval
              ? `Task "${task.title}" already has a pending approval request.`
              : `Assignment for "${task.title}" needs human approval.`
            : `Task "${task.title}" assigned successfully.`,
        );
        await refreshWorkspace();
      } catch (error) {
        showMessage(error.message, "error");
      } finally {
        setLoadingState(assignButton, false);
      }
    });

    completeToggle.addEventListener("click", () => {
      toggleDetails(true);
      completeForm.classList.remove("hidden");
      completionTextarea.focus();
    });

    detailsToggle.addEventListener("click", () => {
      toggleDetails();
      if (detailsSection.classList.contains("hidden")) {
        completeForm.classList.add("hidden");
      }
    });

    completeForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      try {
        const submitButton = completeForm.querySelector("button[type='submit']");
        setLoadingState(submitButton, true, "Completing...");
        await request("/api/task/complete", {
          method: "POST",
          body: JSON.stringify({
            taskId: task.id,
            completionNotes: completionTextarea.value.trim(),
          }),
        });
        showMessage(`Task "${task.title}" completed and evaluated.`);
        completeForm.reset();
        await refreshWorkspace();
      } catch (error) {
        showMessage(error.message, "error");
      } finally {
        const submitButton = completeForm.querySelector("button[type='submit']");
        setLoadingState(submitButton, false);
      }
    });

    selectors.taskList.appendChild(fragment);
  });
};

const renderApprovals = () => {
  const approvals = (state.workspace?.approvals || []).filter(isPendingApproval);
  selectors.approvalList.innerHTML = "";
  selectors.approvalsEmpty.classList.toggle("hidden", approvals.length !== 0);

  approvals.forEach((approval) => {
    const fragment = selectors.approvalTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".approval-card");
    const statusChip = fragment.querySelector(".approval-status");
    const link = fragment.querySelector(".approval-link");
    const title = fragment.querySelector(".approval-title");
    const reason = fragment.querySelector(".approval-reason");
    const worker = fragment.querySelector(".approval-worker");
    const confidence = fragment.querySelector(".approval-confidence");
    const form = fragment.querySelector(".approval-form");
    const rejectButton = fragment.querySelector(".action-reject");

    statusChip.textContent = approval.status || "Pending";
    applyStatusClass(statusChip, approval.status);
    title.textContent = approval.taskTitle || "Approval Request";
    reason.textContent = approval.reason || "No reason provided.";
    worker.textContent = `Suggested Worker: ${approval.workerName || approval.workerId || "Unknown"}`;
    confidence.textContent = `Confidence: ${approval.confidence !== undefined ? formatNumber(approval.confidence, 2) : "N/A"}`;
    link.href = approval.notionUrl || "#";
    link.classList.toggle("hidden", !approval.notionUrl);
    card.dataset.approvalId = approval.id;

    const submitDecision = async (approved) => {
      const reviewer = form.elements.reviewer.value.trim();
      const notes = form.elements.notes.value.trim();

      if (!reviewer) {
        showMessage("Reviewer is required for approval decisions.", "error");
        return;
      }

      try {
        const submitButton = approved ? form.querySelector(".action-approve") : rejectButton;
        setLoadingState(submitButton, true, approved ? "Approving..." : "Rejecting...");
        const result = await request("/api/task/approve", {
          method: "POST",
          body: JSON.stringify({
            approvalId: approval.id,
            approved,
            reviewer,
            notes,
          }),
        });
        applyApprovalDecisionResult(result);
        showMessage(approved ? "Approval completed and task assigned." : "Recommendation rejected and task reopened.");
        window.setTimeout(() => {
          void refreshWorkspace();
        }, 500);
      } catch (error) {
        showMessage(error.message, "error");
      } finally {
        setLoadingState(form.querySelector(".action-approve"), false);
        setLoadingState(rejectButton, false);
      }
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitDecision(true);
    });

    rejectButton.addEventListener("click", async () => {
      await submitDecision(false);
    });

    selectors.approvalList.appendChild(fragment);
  });
};

const renderWorkers = () => {
  const workers = state.workspace?.workers || [];
  selectors.workerList.innerHTML = "";

  workers.forEach((worker) => {
    const card = document.createElement("article");
    card.className = "worker-card";
    const head = document.createElement("div");
    head.className = "worker-head";

    const name = document.createElement("h3");
    name.className = "worker-name";
    name.textContent = worker.name;

    const status = document.createElement("span");
    status.className = `badge ${toStatusClass(worker.availability)}`.trim();
    status.textContent = worker.availability || "Unknown";

    head.append(name, status);

    const skills = document.createElement("div");
    skills.className = "worker-skills";
    skills.textContent = worker.skills?.length ? worker.skills.join(", ") : "No skills listed.";

    const meta = document.createElement("div");
    meta.className = "worker-meta";

    [
      `Timezone: ${worker.timezone || "N/A"}`,
      `Rate: ${worker.hourlyRate !== undefined ? `$${worker.hourlyRate}/hr` : "N/A"}`,
      `Load: ${worker.activeTaskCount ?? 0}${worker.capacity ? ` / ${worker.capacity}` : ""}`,
    ].forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "detail-item";
      chip.textContent = text;
      meta.appendChild(chip);
    });

    card.append(head, skills, meta);
    selectors.workerList.appendChild(card);
  });
};

const renderLogs = () => {
  const logs = state.workspace?.logs || [];
  selectors.logList.innerHTML = "";

  const parsePayload = (payload) => {
    if (!payload) {
      return null;
    }

    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  };

  logs.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "timeline-item";
    const title = document.createElement("strong");
    title.textContent = entry.eventType || "EVENT";

    const message = document.createElement("div");
    message.textContent = entry.message || "No message";

    const timestamp = document.createElement("span");
    timestamp.textContent = formatDate(entry.timestamp);

    item.append(title, message);

    if (entry.eventType === "TASK_UPDATED_MANUALLY") {
      const payload = parsePayload(entry.payload);
      const changeSummary = Array.isArray(payload?.changeSummary)
        ? payload.changeSummary.filter((value) => typeof value === "string" && value.trim() !== "")
        : [];

      if (changeSummary.length > 0) {
        const details = document.createElement("div");
        details.className = "timeline-details";

        const detailsLabel = document.createElement("div");
        detailsLabel.className = "timeline-details-label";
        detailsLabel.textContent = "Changed in Notion";
        details.appendChild(detailsLabel);

        const changeList = document.createElement("ul");
        changeList.className = "timeline-change-list";

        changeSummary.forEach((summary) => {
          const listItem = document.createElement("li");
          listItem.className = "timeline-change-item";
          listItem.textContent = summary;
          changeList.appendChild(listItem);
        });

        details.appendChild(changeList);
        item.appendChild(details);
      }
    }

    item.append(timestamp);
    selectors.logList.appendChild(item);
  });
};

const renderAuditPanelState = () => {
  if (!selectors.auditPanel || !selectors.auditToggle || !selectors.auditLogRegion) {
    return;
  }

  selectors.auditPanel.classList.toggle("is-collapsed", state.auditTrailCollapsed);
  selectors.auditLogRegion.hidden = state.auditTrailCollapsed;
  selectors.auditToggle.textContent = state.auditTrailCollapsed ? "Show Logs" : "Hide Logs";
  selectors.auditToggle.setAttribute("aria-expanded", String(!state.auditTrailCollapsed));
};

const renderAuditChat = () => {
  if (!selectors.auditChatThread) {
    return;
  }

  selectors.auditChatThread.innerHTML = "";

  state.auditChatMessages.forEach((entry) => {
    const bubble = document.createElement("article");
    bubble.className = `chat-message ${entry.role === "user" ? "is-user" : "is-assistant"}`;

    const role = document.createElement("div");
    role.className = "chat-role";
    role.textContent = entry.role === "user" ? "You" : "Audit Assistant";

    const text = document.createElement("div");
    text.className = "chat-text";
    text.innerHTML = renderMessageMarkup(entry.content);

    bubble.append(role, text);
    selectors.auditChatThread.appendChild(bubble);
  });

  selectors.auditChatThread.scrollTop = selectors.auditChatThread.scrollHeight;
};

const updateWorkspaceTask = (updatedTask) => {
  if (!state.workspace?.tasks || !updatedTask?.id) {
    return;
  }

  state.workspace.tasks = state.workspace.tasks.map((task) =>
    task.id === updatedTask.id || task.pageId === updatedTask.id ? { ...task, ...updatedTask } : task,
  );
};

const removeWorkspaceApproval = (approvalId) => {
  if (!state.workspace?.approvals || !approvalId) {
    return;
  }

  state.workspace.approvals = state.workspace.approvals.filter((approval) => approval.id !== approvalId);
};

const removeWorkspaceApprovals = (approvalIds = []) => {
  if (!Array.isArray(approvalIds) || approvalIds.length === 0) {
    return;
  }

  approvalIds.forEach((approvalId) => {
    removeWorkspaceApproval(approvalId);
  });
};

const applyApprovalDecisionResult = (result) => {
  if (!state.workspace || !result) {
    return;
  }

  if (result.task) {
    updateWorkspaceTask(result.task);
  }

  if (Array.isArray(result.resolvedApprovalIds) && result.resolvedApprovalIds.length > 0) {
    removeWorkspaceApprovals(result.resolvedApprovalIds);
  } else if (result.approval?.id) {
    removeWorkspaceApproval(result.approval.id);
  }

  if (state.workspace.stats && typeof state.workspace.stats.pendingApprovals === "number") {
    const removedCount = Array.isArray(result.resolvedApprovalIds) && result.resolvedApprovalIds.length > 0
      ? result.resolvedApprovalIds.length
      : 1;
    state.workspace.stats.pendingApprovals = Math.max(0, state.workspace.stats.pendingApprovals - removedCount);
  }

  renderWorkspace();
};

const renderWorkspace = () => {
  renderMeta();
  renderStats();
  renderTasks();
  renderApprovals();
  renderWorkers();
  renderLogs();
  renderAuditChat();
  renderAuditPanelState();
};

const refreshWorkspace = async (showRefreshToast = false) => {
  try {
    selectors.connectionStatus.textContent = "Syncing...";

    const [meta, workspace] = await Promise.all([
      request("/api/meta"),
      request("/api/workspace"),
    ]);

    state.meta = meta;
    state.workspace = workspace;
    renderWorkspace();

    if (showRefreshToast) {
      showMessage("Workspace refreshed from Notion.");
    }
  } catch (error) {
    selectors.connectionStatus.textContent = "Offline";
    showMessage(error.message, "error");
  }
};

selectors.refreshButton.addEventListener("click", async () => {
  await refreshWorkspace(true);
});

selectors.taskFilterBar.querySelectorAll(".filter-pill").forEach((button) => {
  button.addEventListener("click", () => {
    state.taskFilter = button.dataset.filter || "all";
    renderTasks();
  });
});

selectors.auditToggle?.addEventListener("click", () => {
  state.auditTrailCollapsed = !state.auditTrailCollapsed;

  try {
    window.localStorage.setItem(AUDIT_PANEL_STORAGE_KEY, String(state.auditTrailCollapsed));
  } catch {
    // Ignore storage failures and keep the in-memory toggle state.
  }

  renderAuditPanelState();
});

const askAuditChat = async (message) => {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    showMessage("Ask a question for the audit assistant first.", "error");
    return;
  }

  state.auditChatMessages.push({
    role: "user",
    content: trimmedMessage,
  });
  renderAuditChat();

  const submitButton = selectors.auditChatForm?.querySelector("button[type='submit']");
  const suggestionButtons = selectors.auditSuggestions?.querySelectorAll("button") || [];

  try {
    setLoadingState(submitButton, true, "Thinking...");
    suggestionButtons.forEach((button) => {
      button.disabled = true;
    });

    const response = await request("/api/logs/chat", {
      method: "POST",
      body: JSON.stringify({
        message: trimmedMessage,
        history: state.auditChatMessages.slice(-8),
      }),
    });

    state.auditChatMessages.push({
      role: "assistant",
      content: response.answer || "I could not produce an audit answer.",
    });
    renderAuditChat();
  } catch (error) {
    state.auditChatMessages.push({
      role: "assistant",
      content: `I hit an error while reading the audit logs: ${error.message}`,
    });
    renderAuditChat();
    showMessage(error.message, "error");
  } finally {
    setLoadingState(submitButton, false);
    suggestionButtons.forEach((button) => {
      button.disabled = false;
    });
  }
};

selectors.createTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(selectors.createTaskForm);
  const payload = {
    title: formData.get("title")?.toString().trim(),
    description: formData.get("description")?.toString().trim(),
    requiredSkill: formData.get("requiredSkill")?.toString().trim(),
    priority: formData.get("priority")?.toString().trim() || "Medium",
    budget: formData.get("budget") ? Number(formData.get("budget")) : undefined,
    timezonePreference: formData.get("timezonePreference")?.toString().trim() || undefined,
    createdBy: formData.get("createdBy")?.toString().trim() || undefined,
  };

  try {
    const submitButton = selectors.createTaskForm.querySelector("button[type='submit']");
    setLoadingState(submitButton, true, "Creating...");
    const response = await request("/api/task/create", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    selectors.createTaskForm.reset();
    showMessage(`Task "${response.task.title}" created in Notion.`);
    await refreshWorkspace();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    const submitButton = selectors.createTaskForm.querySelector("button[type='submit']");
    setLoadingState(submitButton, false);
  }
});

selectors.auditChatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = selectors.auditChatInput?.value || "";
  if (selectors.auditChatInput) {
    selectors.auditChatInput.value = "";
  }
  await askAuditChat(message);
});

selectors.auditSuggestions?.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", async () => {
    const prompt = button.dataset.prompt || "";
    if (selectors.auditChatInput) {
      selectors.auditChatInput.value = "";
    }
    await askAuditChat(prompt);
  });
});

const startPolling = () => {
  if (state.pollHandle) {
    window.clearInterval(state.pollHandle);
  }

  state.pollHandle = window.setInterval(() => {
    refreshWorkspace(false);
  }, 15000);
};

document.addEventListener("visibilitychange", async () => {
  if (!document.hidden) {
    await refreshWorkspace(false);
  }
});

window.addEventListener("focus", async () => {
  await refreshWorkspace(false);
});

renderAuditChat();
renderAuditPanelState();
await refreshWorkspace();
startPolling();
