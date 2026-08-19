import { serperSearch } from "./serper";
import { webFetch } from "./web-fetch";
import { memorySave, memoryLoad } from "./memory";
import { fileRead, fileWrite, fileList } from "./files";
import { codeExec } from "./code-exec";
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
import { r2ListRepositories, r2ListFiles, r2ReadFile, r2UploadFile, r2SearchFiles } from "./r2";
import { codeReview, codeEdit } from "./code-tools";
import { netlifyDeploy, netlifyListDeploys } from "./netlify-deploy";
import { proactiveMessage } from "./proactive-message";

export const ALL_TOOLS = {
  serper_search: serperSearch,
  web_fetch: webFetch,
  memory_save: memorySave,
  memory_load: memoryLoad,
  file_read: fileRead,
  file_write: fileWrite,
  file_list: fileList,
  code_exec: codeExec,
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
  r2_list_repos: r2ListRepositories,
  r2_list_files: r2ListFiles,
  r2_read_file: r2ReadFile,
  r2_upload_file: r2UploadFile,
  r2_search_files: r2SearchFiles,
  code_review: codeReview,
  code_edit: codeEdit,
  netlify_deploy: netlifyDeploy,
  netlify_list_deploys: netlifyListDeploys,
  proactive_message: proactiveMessage,
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
