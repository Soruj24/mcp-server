// src/index.ts

import 'dotenv/config';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { google } from 'googleapis';
import * as z from 'zod/v4';

// ============================================
// ENVIRONMENT VARIABLES
// ============================================

const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
    NWS_USER_AGENT,
} = process.env;

if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_REFRESH_TOKEN
) {
    console.error(
        'Missing Google OAuth environment variables. Check your .env file.'
    );

    process.exit(1);
}

// ============================================
// GOOGLE CALENDAR AUTHENTICATION
// ============================================

const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
    refresh_token: GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({
    version: 'v3',
    auth: oauth2Client,
});




// ============================================
// HELPERS
// ============================================

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function isValidDate(value: string): boolean {
    return !Number.isNaN(Date.parse(value));
}

function validateEventTimes(
    startTime: string,
    endTime: string
): boolean {
    const start = Date.parse(startTime);
    const end = Date.parse(endTime);

    return (
        !Number.isNaN(start) &&
        !Number.isNaN(end) &&
        end > start
    );
}

// ============================================
// MCP SERVER
// ============================================

function createServer(): McpServer {
    const server = new McpServer({
        name: 'google-calendar',
        version: '1.0.0',
    });



    // ==========================================
    // TOOL 2: LIST CALENDAR EVENTS
    // ==========================================

    server.registerTool(
        'list_events',
        {
            description:
                "List upcoming events from the user's primary Google Calendar.",
            inputSchema: z.object({
                maxResults: z
                    .number()
                    .int()
                    .min(1)
                    .max(100)
                    .default(10)
                    .describe('Maximum number of events to return'),

                timeMin: z
                    .string()
                    .optional()
                    .describe(
                        'ISO date-time. Defaults to the current time.'
                    ),
            }),
        },

        async ({ maxResults, timeMin }) => {
            try {
                const startTime =
                    timeMin ?? new Date().toISOString();

                if (!isValidDate(startTime)) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: 'text',
                                text: 'Invalid timeMin. Provide a valid ISO date-time.',
                            },
                        ],
                    };
                }

                const response = await calendar.events.list({
                    calendarId: 'primary',
                    timeMin: new Date(startTime).toISOString(),
                    maxResults,
                    singleEvents: true,
                    orderBy: 'startTime',
                });

                const events = response.data.items ?? [];

                if (events.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'No upcoming events found.',
                            },
                        ],
                    };
                }

                const formattedEvents = events.map((event) => ({
                    id: event.id,
                    summary: event.summary ?? 'No Title',
                    description: event.description ?? '',
                    start:
                        event.start?.dateTime ??
                        event.start?.date ??
                        null,
                    end:
                        event.end?.dateTime ??
                        event.end?.date ??
                        null,
                    htmlLink: event.htmlLink ?? null,
                    status: event.status ?? null,
                }));

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(formattedEvents, null, 2),
                        },
                    ],
                };
            } catch (error: unknown) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `Failed to list events: ${getErrorMessage(error)}`,
                        },
                    ],
                };
            }
        }
    );

    // ==========================================
    // TOOL 3: CREATE CALENDAR EVENT
    // ==========================================

    server.registerTool(
        'create_event',
        {
            description:
                "Create a new event in the user's primary Google Calendar.",
            inputSchema: z.object({
                summary: z
                    .string()
                    .min(1)
                    .describe('Title of the event'),

                description: z
                    .string()
                    .optional()
                    .describe('Event description or notes'),

                startTime: z
                    .string()
                    .describe(
                        'ISO date-time start, e.g. 2026-11-03T14:00:00+06:00'
                    ),

                endTime: z
                    .string()
                    .describe(
                        'ISO date-time end, e.g. 2026-11-03T15:00:00+06:00'
                    ),

                timeZone: z
                    .string()
                    .optional()
                    .default('Asia/Dhaka')
                    .describe('IANA timezone'),
            }),
        },

        async ({
            summary,
            description,
            startTime,
            endTime,
            timeZone,
        }) => {
            try {
                if (!validateEventTimes(startTime, endTime)) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: 'text',
                                text: 'Invalid event time. End time must be later than start time.',
                            },
                        ],
                    };
                }

                const response = await calendar.events.insert({
                    calendarId: 'primary',

                    requestBody: {
                        summary,
                        description,

                        start: {
                            dateTime: startTime,
                            timeZone,
                        },

                        end: {
                            dateTime: endTime,
                            timeZone,
                        },
                    },
                });

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    message: 'Event created successfully.',
                                    id: response.data.id,
                                    summary: response.data.summary,
                                    start: response.data.start,
                                    end: response.data.end,
                                    htmlLink: response.data.htmlLink,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            } catch (error: unknown) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `Failed to create event: ${getErrorMessage(error)}`,
                        },
                    ],
                };
            }
        }
    );

    // ==========================================
    // TOOL 4: UPDATE CALENDAR EVENT
    // ==========================================

    server.registerTool(
        'update_event',
        {
            description:
                'Update an existing event in the primary Google Calendar. Requires the event ID.',
            inputSchema: z
                .object({
                    eventId: z
                        .string()
                        .min(1)
                        .describe('Google Calendar event ID'),

                    summary: z
                        .string()
                        .optional()
                        .describe('New event title'),

                    description: z
                        .string()
                        .optional()
                        .describe('New event description'),

                    startTime: z
                        .string()
                        .optional()
                        .describe('New ISO date-time start'),

                    endTime: z
                        .string()
                        .optional()
                        .describe('New ISO date-time end'),

                    timeZone: z
                        .string()
                        .optional()
                        .default('Asia/Dhaka'),
                })
                .refine(
                    (data) =>
                        data.summary !== undefined ||
                        data.description !== undefined ||
                        data.startTime !== undefined ||
                        data.endTime !== undefined,
                    {
                        message:
                            'Provide at least one field to update.',
                    }
                ),
        },

        async ({
            eventId,
            summary,
            description,
            startTime,
            endTime,
            timeZone,
        }) => {
            try {
                // Validate provided dates.
                if (
                    startTime !== undefined &&
                    !isValidDate(startTime)
                ) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: 'text',
                                text: 'Invalid startTime.',
                            },
                        ],
                    };
                }

                if (
                    endTime !== undefined &&
                    !isValidDate(endTime)
                ) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: 'text',
                                text: 'Invalid endTime.',
                            },
                        ],
                    };
                }

                // If both dates are supplied, validate their order.
                if (
                    startTime !== undefined &&
                    endTime !== undefined &&
                    !validateEventTimes(startTime, endTime)
                ) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: 'text',
                                text: 'End time must be later than start time.',
                            },
                        ],
                    };
                }

                const requestBody: Record<string, unknown> = {};

                if (summary !== undefined) {
                    requestBody.summary = summary;
                }

                if (description !== undefined) {
                    requestBody.description = description;
                }

                if (startTime !== undefined) {
                    requestBody.start = {
                        dateTime: startTime,
                        timeZone,
                    };
                }

                if (endTime !== undefined) {
                    requestBody.end = {
                        dateTime: endTime,
                        timeZone,
                    };
                }

                const response = await calendar.events.patch({
                    calendarId: 'primary',
                    eventId,
                    requestBody,
                });

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    message: 'Event updated successfully.',
                                    id: response.data.id,
                                    summary: response.data.summary,
                                    start: response.data.start,
                                    end: response.data.end,
                                    htmlLink: response.data.htmlLink,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            } catch (error: unknown) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `Failed to update event: ${getErrorMessage(error)}`,
                        },
                    ],
                };
            }
        }
    );

    // ==========================================
    // TOOL 5: DELETE CALENDAR EVENT
    // ==========================================

    server.registerTool(
        'delete_event',
        {
            description:
                'Delete an event from the primary Google Calendar. Requires the event ID.',
            inputSchema: z.object({
                eventId: z
                    .string()
                    .min(1)
                    .describe('Google Calendar event ID'),
            }),
        },

        async ({ eventId }) => {
            try {
                await calendar.events.delete({
                    calendarId: 'primary',
                    eventId,
                });

                return {
                    content: [
                        {
                            type: 'text',
                            text: `Event deleted successfully. Event ID: ${eventId}`,
                        },
                    ],
                };
            } catch (error: unknown) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: `Failed to delete event: ${getErrorMessage(error)}`,
                        },
                    ],
                };
            }
        }
    );

    return server;
}

// ============================================
// START MCP SERVER
// ============================================

void serveStdio(createServer);

console.error(
    'Google Calendar + Weather MCP Server running on stdio'
);