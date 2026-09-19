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
  MCP_API_TOKEN,
  PORT = 3000,
} = process.env;

if (
  !GOOGLE_CLIENT_ID ||
  !GOOGLE_CLIENT_SECRET ||
  !GOOGLE_REFRESH_TOKEN ||
  !MCP_API_TOKEN
) {
  console.error("Missing required environment variables.");
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

const LABEL_PROCESSED = "SMM/Processed";
const LABEL_SUPPRESSED = "SMM/Suppressed";

function decodeBase64Url(data = "") {
  if (!data) return "";

  const normalized = data
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function getHeader(headers = [], name) {
  return (
    headers.find(
      (header) =>
        header.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? ""
  );
}

function extractPlainText(payload) {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts?.length) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }

  return "";
}

function extractHtmlText(payload) {
  if (!payload) return "";

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }

  if (payload.parts?.length) {
    for (const part of payload.parts) {
      const text = extractHtmlText(part);
      if (text) return text;
    }
  }

  return "";
}

function extractBody(payload) {
  const plainText = extractPlainText(payload);
  if (plainText) return plainText;

  const htmlText = extractHtmlText(payload);
  if (htmlText) return htmlText;

  if (payload?.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return "";
}

function cleanBody(text = "") {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function compactMessage(message) {
  const headers = message.payload?.headers ?? [];
  const body = cleanBody(extractBody(message.payload));

  const maxBodyChars = 5000;

  return {
    messageId: message.id ?? "",
    threadId: message.threadId ?? "",
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc"),
    date: getHeader(headers, "Date"),
    subject: getHeader(headers, "Subject"),
    messageIdHeader: getHeader(headers, "Message-ID"),
    inReplyTo: getHeader(headers, "In-Reply-To"),
    references: getHeader(headers, "References"),
    snippet: message.snippet ?? "",
    labels: message.labelIds ?? [],
    body:
      body.length > maxBodyChars
        ? `${body.slice(0, maxBodyChars)}\n\n[Message body truncated]`
        : body,
  };
}

async function ensureLabel(labelName) {
  const existing = await gmail.users.labels.list({
    userId: "me",
  });

  const found = (existing.data.labels ?? []).find(
    (label) => label.name === labelName
  );

  if (found?.id) {
    return found.id;
  }

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  if (!created.data.id) {
    throw new Error(`Failed to create Gmail label: ${labelName}`);
  }

  return created.data.id;
}

async function applyLabelToMessage(messageId, labelName) {
  const labelId = await ensureLabel(labelName);

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [labelId],
    },
  });

  return {
    messageId,
    labelName,
    labelId,
  };
}

function createServer() {
  const server = new McpServer({
    name: "smm-gmail-mcp",
    version: "1.2.0",
  });

  server.registerTool(
    "search_gmail",
    {
      title: "Search Gmail",
      description:
        "Search Gmail messages using standard Gmail search syntax.",
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                resultSizeEstimate:
                  result.data.resultSizeEstimate ?? 0,
                messages: result.data.messages ?? [],
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
        "Read a Gmail message in a compact decoded format suitable for analysis.",
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
            text: JSON.stringify(
              compactMessage(result.data),
              null,
              2
            ),
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
        "Read an entire Gmail thread in a compact decoded format suitable for summarization.",
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

      const messages = (result.data.messages ?? []).map(
        compactMessage
      );

      const thread = {
        threadId: result.data.id ?? threadId,
        messageCount: messages.length,
        messages,
      };

      let text = JSON.stringify(thread, null, 2);

      const maxThreadChars = 35000;

      if (text.length > maxThreadChars) {
        text =
          text.slice(0, maxThreadChars) +
          '\n\n{"notice":"Thread output truncated to protect model context."}';
      }

      return {
        content: [
          {
            type: "text",
            text,
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

  server.registerTool(
    "mark_gmail_processed",
    {
      title: "Mark Gmail Message Processed",
      description:
        "Apply the SMM/Processed label to a Gmail message after it has been reviewed and classified.",
      inputSchema: {
        messageId: z.string(),
      },
    },
    async ({ messageId }) => {
      const result = await applyLabelToMessage(
        messageId,
        LABEL_PROCESSED
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...result,
                status: "processed",
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
    "mark_gmail_suppressed",
    {
      title: "Mark Gmail Message Suppressed",
      description:
        "Apply SMM/Suppressed and SMM/Processed labels to a Gmail message representing an opt-out, bounce, or other suppression event.",
      inputSchema: {
        messageId: z.string(),
      },
    },
    async ({ messageId }) => {
      const suppressed = await applyLabelToMessage(
        messageId,
        LABEL_SUPPRESSED
      );

      const processed = await applyLabelToMessage(
        messageId,
        LABEL_PROCESSED
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                messageId,
                suppressedLabel: suppressed.labelName,
                processedLabel: processed.labelName,
                status: "suppressed_and_processed",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "smm-gmail-mcp",
    version: "1.2.0",
  });
});

app.use("/mcp", (req, res, next) => {
  const authHeader = req.get("authorization");

  if (authHeader !== `Bearer ${MCP_API_TOKEN}`) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  next();
});

app.all("/mcp", async (req, res) => {
  const server = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(
      req,
      res,
      req.body
    );
  } catch (error) {
    console.error("MCP request failed:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "MCP request failed",
      });
    }
  } finally {
    try {
      await transport.close();
    } catch {}

    try {
      await server.close();
    } catch {}
  }
});

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(
    `SMM Gmail MCP v1.2.0 listening on port ${PORT}`
  );
});
