
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import {
  readFile,
  realpath,
  stat,
} from "node:fs/promises";

import path from "node:path";
import process from "node:process";

// ========================================
// 1. Configuration
// ========================================

const DOCS_ROOT = path.resolve(
  process.env.DOCS_ROOT ??
    "C:/Users/user/Desktop/English"
);

const MAX_PDF_SIZE =
  Number(process.env.MAX_PDF_SIZE_MB ?? 25) *
  1024 *
  1024;

// ========================================
// 2. Create MCP Server
// ========================================

const server = new McpServer({
  name: "english-learning-server",
  version: "1.0.0",
});

// ========================================
// 3. Security Helpers
// ========================================

function isInsideRoot(
  root: string,
  target: string
): boolean {
  const relative = path.relative(root, target);

  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function validateFileName(file: string): string {
  const fileName = String(file);

  // Only allow a filename, not a path
  if (
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("\0")
  ) {
    throw new Error("Invalid PDF filename");
  }

  // Only PDF files
  if (path.extname(fileName).toLowerCase() !== ".pdf") {
    throw new Error("Only PDF files are allowed");
  }

  return fileName;
}

// ========================================
// 4. Register PDF Resource
// ========================================

server.registerResource(
  "english-pdf",

  new ResourceTemplate(
    "english:///{file}",
    {
      list: undefined,
    }
  ),

  {
    title: "English Learning PDF",
    description:
      "Read English learning PDF documents from the English folder.",
    mimeType: "application/pdf",
  },

  async (uri, { file }) => {
    try {
      // Validate requested filename
      const fileName = validateFileName(
        String(file)
      );

      // Resolve root directory (including symlinks)
      const realRoot = await realpath(DOCS_ROOT);

      // Resolve requested file
      const requestedPath = path.resolve(
        realRoot,
        fileName
      );

      // Check path traversal
      if (!isInsideRoot(realRoot, requestedPath)) {
        throw new Error(
          "Access denied: File is outside allowed directory"
        );
      }

      // Resolve actual file path
      const actualPath = await realpath(requestedPath);

      // Prevent symlink-based path traversal
      if (!isInsideRoot(realRoot, actualPath)) {
        throw new Error(
          "Access denied: Invalid file location"
        );
      }

      // Check file information
      const fileStats = await stat(actualPath);

      if (!fileStats.isFile()) {
        throw new Error("Requested resource is not a file");
      }

      if (fileStats.size > MAX_PDF_SIZE) {
        throw new Error(
          `PDF exceeds maximum size of ${
            process.env.MAX_PDF_SIZE_MB ?? 25
          } MB`
        );
      }

      // Read PDF as binary
      const fileBuffer = await readFile(actualPath);

      // Return Base64 blob
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/pdf",
            blob: fileBuffer.toString("base64"),
          },
        ],
      };
    } catch (error) {
      console.error("PDF Resource Error:", error);

      throw new Error(
        error instanceof Error
          ? error.message
          : "Unable to read PDF resource"
      );
    }
  }
);

// ========================================
// 5. Start MCP Server
// ========================================

async function main() {
  try {
    // Verify root directory
    const realRoot = await realpath(DOCS_ROOT);

    console.error(
      `English documents directory: ${realRoot}`
    );

    // Connect using stdio transport
    const transport = new StdioServerTransport();

    await server.connect(transport);

    console.error(
      "English Learning MCP Server is running"
    );
  } catch (error) {
    console.error("MCP Server Startup Error:", error);
    process.exit(1);
  }
}

// ========================================
// 6. Handle Shutdown
// ========================================

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});

main();
