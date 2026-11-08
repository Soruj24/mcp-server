
import dotenv from 'dotenv';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import * as z from 'zod/v4';
dotenv.config();







// ============================================
// MCP SERVER
// ============================================

function createServer(): McpServer {
    const server = new McpServer({
        name: 'my-server',
        version: '1.0.0',
    });



    return server;
}

// ============================================
// START MCP SERVER
// ============================================

void serveStdio(createServer);

console.error(
     'MCP Server running on stdio'
);