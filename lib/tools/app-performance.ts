import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const appPerformanceLog = tool({
  description:
    "Log daily App Store performance data for an iOS app. Use this to record downloads, revenue, impressions, page views, crashes, and ratings.",
  inputSchema: z.object({
    date: z.string().describe("Date in YYYY-MM-DD format"),
    appId: z.string().optional().describe("The app's App Store ID or bundle ID"),
    appName: z.string().describe("The app name"),
    downloads: z.number().optional().default(0).describe("Number of downloads that day"),
    revenue: z.number().optional().default(0).describe("Revenue that day (in dollars)"),
    impressions: z.number().optional().default(0).describe("App Store impressions"),
    pageViews: z.number().optional().default(0).describe("App Store page views"),
    crashes: z.number().optional().default(0).describe("Number of crashes"),
    ratingsNew: z.number().optional().default(0).describe("New ratings that day"),
    ratingsAvg: z.number().optional().describe("Average rating (0-5)"),
    notes: z.string().optional().describe("Any notes about the day"),
  }),
  execute: async ({ date, appId, appName, downloads, revenue, impressions, pageViews, crashes, ratingsNew, ratingsAvg, notes }) => {
    const id = nanoid();
    const { error } = await supabase.from("app_performance").insert({
      id,
      date,
      app_id: appId ?? null,
      app_name: appName,
      downloads: downloads ?? 0,
      revenue: revenue ?? 0,
      impressions: impressions ?? 0,
      page_views: pageViews ?? 0,
      crashes: crashes ?? 0,
      ratings_new: ratingsNew ?? 0,
      ratings_avg: ratingsAvg ?? null,
      notes: notes ?? null,
    });
    if (error) return { error: error.message };
    return { success: true, id, appName, date };
  },
});

export const appPerformanceReport = tool({
  description:
    "Get a performance report for an iOS app. Returns recent daily data and calculates trends (downloads change, revenue total, etc.). Use this to give the user a daily performance summary.",
  inputSchema: z.object({
    appName: z.string().optional().describe("The app name to report on. If omitted, returns data for all apps."),
    days: z.number().optional().default(7).describe("Number of recent days to include (1-90)"),
  }),
  execute: async ({ appName, days }) => {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - days);
    const dateStr = daysAgo.toISOString().split("T")[0];

    let query = supabase.from("app_performance").select("*").gte("date", dateStr).order("date", { ascending: false });
    if (appName) query = query.eq("app_name", appName);

    const { data, error } = await query;
    if (error) return { error: error.message };

    const records = data ?? [];
    if (records.length === 0) {
      return { message: "No performance data found. Log some data first using app_performance_log.", records: [] };
    }

    // Calculate summary
    const totalDownloads = records.reduce((sum: number, r: { downloads?: number }) => sum + (r.downloads ?? 0), 0);
    const totalRevenue = records.reduce((sum: number, r: { revenue?: number }) => sum + (r.revenue ?? 0), 0);
    const totalImpressions = records.reduce((sum: number, r: { impressions?: number }) => sum + (r.impressions ?? 0), 0);
    const totalPageViews = records.reduce((sum: number, r: { page_views?: number }) => sum + (r.page_views ?? 0), 0);
    const totalCrashes = records.reduce((sum: number, r: { crashes?: number }) => sum + (r.crashes ?? 0), 0);
    const totalRatings = records.reduce((sum: number, r: { ratings_new?: number }) => sum + (r.ratings_new ?? 0), 0);

    // Conversion rate
    const conversionRate = totalImpressions > 0 ? ((totalDownloads / totalImpressions) * 100).toFixed(1) : "0";

    // Latest vs previous day comparison
    const latest = records[0];
    const previous = records[1];
    const downloadsChange = previous ? ((latest.downloads ?? 0) - (previous.downloads ?? 0)) : 0;
    const revenueChange = previous ? ((latest.revenue ?? 0) - (previous.revenue ?? 0)) : 0;

    return {
      summary: {
        days,
        totalDownloads,
        totalRevenue: totalRevenue.toFixed(2),
        totalImpressions,
        totalPageViews,
        conversionRate: `${conversionRate}%`,
        totalCrashes,
        totalRatings,
        latestDate: latest.date,
        latestDownloads: latest.downloads ?? 0,
        latestRevenue: (latest.revenue ?? 0).toFixed(2),
        downloadsChange,
        revenueChange: revenueChange.toFixed(2),
      },
      records,
    };
  },
});
