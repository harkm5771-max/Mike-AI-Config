import express from "express";
import { google } from "googleapis";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  PORT = 3000,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  console.error("Missing required Google OAuth environment variables.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: GOOGLE_REFRESH_TOKEN,
});

const gmail = google.gmail({
  version: "v1",
  auth: oauth2Client,
});

const server = new McpServer({
  name: "smm-gmail-mcp",
  version: "1.0.0",
});

server.registerTool(
  "search_gmail",
  {
    title: "Search Gmail",
    description:
      "Search Gmail messages using standard Gmail search syntax. Read-only.",
    inputSchema: {
      query: z.string().describe("Gmail search query"),
      maxResults: z.number().int().min(1).max(50).default(20),
    },
  },
  async ({ query, maxResults }) => {
    const result = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });

    const messages = result.data.messages ?? [];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              resultSizeEstimate: result.data.resultSizeEstimate ?? 0,
              messages,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "get_gmail_message",
  {
    title: "Read Gmail Message",
    description:
      "Read a Gmail message by message ID. Read-only.",
    inputSchema: {
      messageId: z.string(),
    },
  },
  async ({ messageId }) => {
    const result = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "get_gmail_thread",
  {
    title: "Read Gmail Thread",
    description:
      "Read an entire Gmail thread by thread ID. Read-only.",
    inputSchema: {
      threadId: z.string(),
    },
  },
  async ({ threadId }) => {
    const result = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "full",
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "create_gmail_draft",
  {
    title: "Create Gmail Draft",
    description:
      "Create a Gmail draft. This tool cannot send email.",
    inputSchema: {
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      threadId: z.string().optional(),
      inReplyTo: z.string().optional(),
      references: z.string().optional(),
    },
  },
  async ({
    to,
    subject,
    body,
    threadId,
    inReplyTo,
    references,
  }) => {
    const headers = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
    ];

    if (inReplyTo) {
      headers.push(`In-Reply-To: ${inReplyTo}`);
    }

    if (references) {
      headers.push(`References: ${references}`);
    }

    const mimeMessage =
      headers.join("\r\n") +
      "\r\n\r\n" +
      body;

    const raw = Buffer.from(mimeMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const result = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw,
          ...(threadId ? { threadId } : {}),
        },
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              draftId: result.data.id,
              messageId: result.data.message?.id,
              threadId: result.data.message?.threadId,
              status: "draft_created_not_sent",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.all("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "MCP request failed",
      });
    }
  }
});

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`SMM Gmail MCP listening on port ${PORT}`);
});
