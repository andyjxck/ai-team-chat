import { tool } from "ai";
import { z } from "zod";
import { google } from "googleapis";
import { getAuthenticatedClient } from "../google/auth";

export const calendarList = tool({
  description:
    "List upcoming events from Google Calendar. Returns events with title, start/end times, and attendees.",
  inputSchema: z.object({
    maxResults: z.number().optional().default(10).describe("Max number of events to return (1-50)"),
    timeMin: z.string().optional().describe("Start time in ISO format. Defaults to now."),
    timeMax: z.string().optional().describe("End time in ISO format. Defaults to 7 days from now."),
  }),
  execute: async ({ maxResults, timeMin, timeMax }) => {
    try {
      const auth = await getAuthenticatedClient();
      const calendar = google.calendar({ version: "v3", auth });

      const res = await calendar.events.list({
        calendarId: "primary",
        maxResults: Math.min(maxResults, 50),
        timeMin: timeMin ?? new Date().toISOString(),
        timeMax: timeMax ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = (res.data.items ?? []).map((e) => ({
        id: e.id,
        summary: e.summary ?? "No title",
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        attendees: (e.attendees ?? []).map((a) => a.email).filter(Boolean),
        location: e.location ?? null,
        description: e.description?.slice(0, 500) ?? null,
      }));

      return { events, count: events.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Calendar API failed" };
    }
  },
});

export const calendarCreate = tool({
  description:
    "Create a new event in Google Calendar. Confirm the details with the user before creating.",
  inputSchema: z.object({
    summary: z.string().describe("Event title"),
    start: z.string().describe("Start time in ISO format, e.g. '2025-01-15T09:00:00'"),
    end: z.string().describe("End time in ISO format, e.g. '2025-01-15T10:00:00'"),
    attendees: z.array(z.string().email()).optional().describe("List of attendee email addresses"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
  }),
  execute: async ({ summary, start, end, attendees, description, location }) => {
    try {
      const auth = await getAuthenticatedClient();
      const calendar = google.calendar({ version: "v3", auth });

      const res = await calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary,
          start: { dateTime: start },
          end: { dateTime: end },
          attendees: attendees?.map((email) => ({ email })),
          description,
          location,
        },
      });

      return {
        success: true,
        eventId: res.data.id,
        summary,
        start,
        end,
        htmlLink: res.data.htmlLink,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Calendar API failed" };
    }
  },
});

export const calendarUpdate = tool({
  description: "Update an existing Google Calendar event.",
  inputSchema: z.object({
    eventId: z.string().describe("The ID of the event to update"),
    summary: z.string().optional().describe("New event title"),
    start: z.string().optional().describe("New start time in ISO format"),
    end: z.string().optional().describe("New end time in ISO format"),
    description: z.string().optional().describe("New event description"),
    location: z.string().optional().describe("New event location"),
  }),
  execute: async ({ eventId, summary, start, end, description, location }) => {
    try {
      const auth = await getAuthenticatedClient();
      const calendar = google.calendar({ version: "v3", auth });

      const res = await calendar.events.patch({
        calendarId: "primary",
        eventId,
        requestBody: {
          ...(summary ? { summary } : {}),
          ...(start ? { start: { dateTime: start } } : {}),
          ...(end ? { end: { dateTime: end } } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(location !== undefined ? { location } : {}),
        },
      });

      return { success: true, eventId: res.data.id, summary: res.data.summary };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Calendar API failed" };
    }
  },
});

export const calendarDelete = tool({
  description: "Delete an event from Google Calendar. Confirm with the user before deleting.",
  inputSchema: z.object({
    eventId: z.string().describe("The ID of the event to delete"),
  }),
  execute: async ({ eventId }) => {
    try {
      const auth = await getAuthenticatedClient();
      const calendar = google.calendar({ version: "v3", auth });

      await calendar.events.delete({ calendarId: "primary", eventId });
      return { success: true, eventId };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Calendar API failed" };
    }
  },
});
