import { serperSearch } from "./serper";
import { webFetch } from "./web-fetch";
import { memorySave } from "./memory";
import { imageGen } from "./image-gen";
import { leadsCreate, leadsUpdate, leadsList } from "./leads";
import { contactsCreate, contactsSearch } from "./contacts";
import { reminderCreate, reminderList } from "./reminders";
import { calendarList, calendarCreate, calendarUpdate, calendarDelete } from "./calendar";
import { gmailSend, gmailSearch, gmailRead } from "./gmail";
import { socialPostX } from "./social-x";
import { messageAgent } from "./message-agent";
import { appPerformanceLog, appPerformanceReport } from "./app-performance";
import { draftAction } from "./draft";
import { askQuestion } from "./ask-question";
import { netlifyListDeploys } from "./netlify-deploy";
import { proactiveMessage } from "./proactive-message";
import { delegateTask } from "./delegate-task";
import {
  githubListRepos,
  githubListFiles,
  githubReadFile,
  githubEditFile,
  githubDeleteFile,
  githubGetCommits,
  githubReview,
  githubCreateBranch,
  githubCreatePR,
  githubCreateIssue,
  githubSearchCode,
  githubListBranches,
} from "./github-tools";

export const ALL_TOOLS = {
  serper_search: serperSearch,
  web_fetch: webFetch,
  memory_save: memorySave,
  image_gen: imageGen,
  leads_create: leadsCreate,
  leads_update: leadsUpdate,
  leads_list: leadsList,
  contacts_create: contactsCreate,
  contacts_search: contactsSearch,
  reminder_create: reminderCreate,
  reminder_list: reminderList,
  calendar_list: calendarList,
  calendar_create: calendarCreate,
  calendar_update: calendarUpdate,
  calendar_delete: calendarDelete,
  gmail_send: gmailSend,
  gmail_search: gmailSearch,
  gmail_read: gmailRead,
  social_post_x: socialPostX,
  message_agent: messageAgent,
  app_performance_log: appPerformanceLog,
  app_performance_report: appPerformanceReport,
  draft_action: draftAction,
  ask_question: askQuestion,
  github_list_repos: githubListRepos,
  github_list_files: githubListFiles,
  github_read_file: githubReadFile,
  github_edit_file: githubEditFile,
  github_delete_file: githubDeleteFile,
  github_get_commits: githubGetCommits,
  github_review: githubReview,
  github_create_branch: githubCreateBranch,
  github_create_pr: githubCreatePR,
  github_create_issue: githubCreateIssue,
  github_search_code: githubSearchCode,
  github_list_branches: githubListBranches,
  netlify_list_deploys: netlifyListDeploys,
  proactive_message: proactiveMessage,
  delegate_task: delegateTask,
} as const;

export type ToolName = keyof typeof ALL_TOOLS;

export function getToolsForAgent(toolNames: string[]) {
  const tools: Record<string, typeof ALL_TOOLS[ToolName]> = {};
  for (const name of toolNames) {
    if (name in ALL_TOOLS) {
      tools[name] = ALL_TOOLS[name as ToolName];
    }
  }
  return tools;
}
