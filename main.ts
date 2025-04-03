import { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "npm:@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolRequest,
  CallToolResult,
  Tool,
} from "npm:@modelcontextprotocol/sdk/types.js";
import express from "npm:express";

// ==================== 类型定义 ====================

/**
 * 工具处理器接口
 * 将工具定义和处理逻辑绑定在一起
 */
interface ToolHandler {
  tool: Tool;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

// ==================== 辅助函数 ====================
function generateShortKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function uploadFile(base64: string, filename: string, commitMessage: string) {
  console.log("upload file")
  const kv = await Deno.openKv();
  const token = await kv.get(["github-token"]);
  if (!token) {
    return createTextResponse("未设置 github token", true);
  }
  const repo = await kv.get(["github-repo"]);
  if (!repo) {
    return createTextResponse("未设置 github repo", true);
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filename)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: `Upload image via MCP tool (${commitMessage})`,
      content: base64,
      branch: "master",
    }),
  });
  if (!res.ok) {
    console.error(await res.text());
    console.error('---------------------------------------')
    throw new Error(`Failed to upload file: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.content.download_url;
}
/**
 * 创建文本响应
 * @param text 响应文本
 * @param isError 是否为错误响应
 */
function createTextResponse(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError,
  };
}

// ==================== 工具注册系统 ====================

/**
 * 工具注册表
 * 管理所有可用工具及其处理逻辑
 */
class ToolRegistry {
  private tools: Map<string, ToolHandler> = new Map();

  /**
   * 注册单个工具
   */
  register(toolHandler: ToolHandler): void {
    this.tools.set(toolHandler.tool.name, toolHandler);
  }

  /**
   * 批量注册工具
   */
  registerAll(toolHandlers: ToolHandler[]): void {
    for (const handler of toolHandlers) {
      this.register(handler);
    }
  }

  /**
   * 获取所有已注册工具的定义
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values()).map(th => th.tool);
  }

  /**
   * 处理工具调用请求
   */
  async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    const toolHandler = this.tools.get(name);
    if (!toolHandler) return createTextResponse(`未知工具: ${name}`, true);

    try {
      return await toolHandler.handler(args);
    } catch (error: unknown) {
      return createTextResponse(`工具执行错误: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }
}

// ==================== 工具实现 ====================

/**
 * 可用工具集合
 */
const TOOLS: ToolHandler[] = [
  {
    tool: {
      name: "deploy-to-tiny-server",
      description: "部署到 Tiny Server",
      inputSchema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "要发布的内容"
          },
          suffix: {
            type: "string",
            description: "URL 后缀，例如 '.md' '.gist' '.html' 或空"
          }
        },
        required: ["content", "suffix"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const content = args.content as string;
      const suffix = args.suffix as string;

      try {
        const key = generateShortKey();
        const res = await fetch("https://note.linkof.link/set", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ value: content, key }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error("Failed to publish:", errorText);
          throw new Error(`Failed to publish: ${res.status} ${res.statusText}`);
        }

        const url = `https://note.linkof.link/${key}${suffix}`;
        console.log("Published to:", url);
        return createTextResponse(url);
      } catch (error) {
        return createTextResponse(`发布失败: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  },
  // 日期时间格式化
  {
    tool: {
      name: "formatDateTime",
      description: "格式化日期时间",
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            description: "格式字符串，例如 'YYYY-MM-DD HH:mm:ss'。支持的标记: YYYY(年), MM(月), DD(日), HH(时), mm(分), ss(秒)"
          },
          timestamp: {
            type: "number",
            description: "可选的时间戳（毫秒）。默认为当前时间"
          },
        },
        required: ["format"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const format = args.format as string;
      const timestamp = args.timestamp as number || Date.now();

      try {
        const date = new Date(timestamp);

        if (isNaN(date.getTime())) {
          return createTextResponse(`无效的时间戳: ${timestamp}`, true);
        }

        const formatMap: Record<string, string> = {
          'YYYY': date.getFullYear().toString(),
          'MM': (date.getMonth() + 1).toString().padStart(2, '0'),
          'DD': date.getDate().toString().padStart(2, '0'),
          'HH': date.getHours().toString().padStart(2, '0'),
          'mm': date.getMinutes().toString().padStart(2, '0'),
          'ss': date.getSeconds().toString().padStart(2, '0'),
        };

        let result = format;
        for (const [token, value] of Object.entries(formatMap)) {
          result = result.replace(new RegExp(token, 'g'), value);
        }

        return createTextResponse(result);
      } catch (error) {
        return createTextResponse(`日期格式化错误: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  },

  // JSON 格式化与验证
  {
    tool: {
      name: "formatJSON",
      description: "格式化和验证 JSON 字符串",
      inputSchema: {
        type: "object",
        properties: {
          json: { type: "string", description: "要格式化的 JSON 字符串" },
          indent: { type: "number", description: "缩进空格数，默认为 2" },
        },
        required: ["json"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const jsonStr = args.json as string;
      const indent = (args.indent as number) || 2;

      try {
        const parsed = JSON.parse(jsonStr);
        return createTextResponse(JSON.stringify(parsed, null, indent));
      } catch (error) {
        return createTextResponse(`JSON 解析错误: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  },

  // 文本统计
  {
    tool: {
      name: "textStats",
      description: "分析文本并返回统计信息",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "要分析的文本" },
        },
        required: ["text"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const text = args.text as string;

      if (typeof text !== "string") {
        return createTextResponse(`输入应为字符串，但收到了 ${typeof text}`, true);
      }

      const charCount = text.length;
      const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
      const lineCount = text.split(/\r\n|\r|\n/).length;

      // 计算字符频率
      const charFrequency: Record<string, number> = {};
      for (const char of text) {
        charFrequency[char] = (charFrequency[char] || 0) + 1;
      }

      // 获取前10个最常见字符
      const topChars = Object.entries(charFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([char, count]) => `"${char === ' ' ? '空格' : char === '\n' ? '换行' : char === '\t' ? '制表符' : char}": ${count}`)
        .join(', ');

      const result = {
        字符数: charCount,
        单词数: wordCount,
        行数: lineCount,
        常见字符: topChars
      };

      return createTextResponse(JSON.stringify(result, null, 2));
    }
  },

  // 进制转换
  {
    tool: {
      name: "convertBase",
      description: "在不同进制之间转换数字",
      inputSchema: {
        type: "object",
        properties: {
          number: { type: "string", description: "要转换的数字（字符串形式）" },
          fromBase: { type: "number", description: "原始进制（2-36）" },
          toBase: { type: "number", description: "目标进制（2-36）" },
        },
        required: ["number", "fromBase", "toBase"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const numStr = args.number as string;
      const fromBase = args.fromBase as number;
      const toBase = args.toBase as number;

      if (fromBase < 2 || fromBase > 36 || toBase < 2 || toBase > 36) {
        return createTextResponse("进制必须在 2-36 范围内", true);
      }

      try {
        // 先转为十进制
        const decimal = parseInt(numStr, fromBase);

        if (isNaN(decimal)) {
          return createTextResponse(`无法将 "${numStr}" 解析为 ${fromBase} 进制数`, true);
        }

        // 再从十进制转为目标进制
        const result = decimal.toString(toBase);

        return createTextResponse(result);
      } catch (error) {
        return createTextResponse(`进制转换错误: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  },

  // 随机数生成
  {
    tool: {
      name: "generateRandom",
      description: "生成随机数或随机字符串",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "生成类型: 'number'(数字), 'string'(字符串), 'uuid'(UUID)"
          },
          min: {
            type: "number",
            description: "当type为number时的最小值（包含）"
          },
          max: {
            type: "number",
            description: "当type为number时的最大值（包含）"
          },
          length: {
            type: "number",
            description: "当type为string时的字符串长度"
          },
          charset: {
            type: "string",
            description: "当type为string时的字符集: 'alphanumeric'(字母数字), 'alpha'(字母), 'numeric'(数字), 'hex'(十六进制), 'custom'(自定义)"
          },
          customCharset: {
            type: "string",
            description: "当charset为custom时的自定义字符集"
          },
        },
        required: ["type"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const type = args.type as string;

      try {
        if (type === "number") {
          const min = typeof args.min === "number" ? args.min : 0;
          const max = typeof args.max === "number" ? args.max : 100;

          if (min > max) {
            return createTextResponse("最小值不能大于最大值", true);
          }

          const random = Math.floor(Math.random() * (max - min + 1)) + min;
          return createTextResponse(random.toString());
        }
        else if (type === "string") {
          const length = typeof args.length === "number" ? args.length : 10;
          const charset = args.charset as string || "alphanumeric";

          let chars = "";
          switch (charset) {
            case "alphanumeric":
              chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
              break;
            case "alpha":
              chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
              break;
            case "numeric":
              chars = "0123456789";
              break;
            case "hex":
              chars = "0123456789abcdef";
              break;
            case "custom":
              chars = args.customCharset as string || "";
              if (!chars) {
                return createTextResponse("自定义字符集不能为空", true);
              }
              break;
            default:
              return createTextResponse(`未知字符集类型: ${charset}`, true);
          }

          let result = "";
          for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
          }

          return createTextResponse(result);
        }
        else if (type === "uuid") {
          // 简单的 UUID v4 实现
          const hex = "0123456789abcdef";
          let uuid = "";

          for (let i = 0; i < 36; i++) {
            if (i === 8 || i === 13 || i === 18 || i === 23) {
              uuid += "-";
            } else if (i === 14) {
              uuid += "4"; // UUID 版本
            } else if (i === 19) {
              uuid += hex.charAt(Math.random() * 4 + 8); // UUID 变体
            } else {
              uuid += hex.charAt(Math.floor(Math.random() * 16));
            }
          }

          return createTextResponse(uuid);
        }
        else {
          return createTextResponse(`未支持的随机类型: ${type}`, true);
        }
      } catch (error) {
        return createTextResponse(`随机生成错误: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  },

  // 单位转换
  {
    tool: {
      name: "convertUnit",
      description: "在不同单位之间转换数值",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "number", description: "要转换的数值" },
          category: {
            type: "string",
            description: "转换类别: 'length'(长度), 'weight'(重量), 'temperature'(温度), 'area'(面积), 'volume'(体积), 'time'(时间)"
          },
          fromUnit: { type: "string", description: "原始单位" },
          toUnit: { type: "string", description: "目标单位" },
        },
        required: ["value", "category", "fromUnit", "toUnit"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const value = args.value as number;
      const category = args.category as string;
      const fromUnit = args.fromUnit as string;
      const toUnit = args.toUnit as string;

      try {
        // 各种单位转换表（转换为基本单位的系数）
        const conversionTables: Record<string, Record<string, number | string>> = {
          length: {
            'mm': 0.001, 'cm': 0.01, 'm': 1, 'km': 1000,
            'in': 0.0254, 'ft': 0.3048, 'yd': 0.9144, 'mi': 1609.344
          },
          weight: {
            'mg': 0.000001, 'g': 0.001, 'kg': 1, 't': 1000,
            'oz': 0.0283495, 'lb': 0.453592, 'st': 6.35029
          },
          temperature: {
            'C': 'celsius', 'F': 'fahrenheit', 'K': 'kelvin'
          },
          area: {
            'mm2': 0.000001, 'cm2': 0.0001, 'm2': 1, 'km2': 1000000,
            'in2': 0.00064516, 'ft2': 0.092903, 'ac': 4046.86, 'ha': 10000
          },
          volume: {
            'ml': 0.001, 'l': 1, 'm3': 1000,
            'tsp': 0.00492892, 'tbsp': 0.0147868, 'fl-oz': 0.0295735, 'cup': 0.236588,
            'pt': 0.473176, 'qt': 0.946353, 'gal': 3.78541
          },
          time: {
            'ms': 0.001, 's': 1, 'min': 60, 'h': 3600,
            'day': 86400, 'week': 604800, 'month': 2592000, 'year': 31536000
          }
        };

        // 检查类别是否支持
        if (!conversionTables[category]) {
          return createTextResponse(`不支持的转换类别: ${category}`, true);
        }

        // 检查单位是否支持
        if (category !== 'temperature') {
          if (!(fromUnit in conversionTables[category])) {
            return createTextResponse(`不支持的源单位: ${fromUnit}`, true);
          }
          if (!(toUnit in conversionTables[category])) {
            return createTextResponse(`不支持的目标单位: ${toUnit}`, true);
          }
        }

        let result: number;

        // 温度需要特殊处理
        if (category === 'temperature') {
          // 先转换为开尔文
          let kelvin: number;
          if (fromUnit === 'C') {
            kelvin = value + 273.15;
          } else if (fromUnit === 'F') {
            kelvin = (value - 32) * 5 / 9 + 273.15;
          } else if (fromUnit === 'K') {
            kelvin = value;
          } else {
            return createTextResponse(`不支持的温度单位: ${fromUnit}`, true);
          }

          // 从开尔文转换为目标单位
          if (toUnit === 'C') {
            result = kelvin - 273.15;
          } else if (toUnit === 'F') {
            result = (kelvin - 273.15) * 9 / 5 + 32;
          } else if (toUnit === 'K') {
            result = kelvin;
          } else {
            return createTextResponse(`不支持的温度单位: ${toUnit}`, true);
          }
        } else {
          // 其他单位转换：先转换为基本单位，再转换为目标单位
          const fromFactor = conversionTables[category][fromUnit] as number;
          const toFactor = conversionTables[category][toUnit] as number;
          const baseValue = value * fromFactor;
          result = baseValue / toFactor;
        }

        return createTextResponse(result.toString());
      } catch (error) {
        return createTextResponse(`单位转换错误: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  },
  {
    tool: {
      name: "gemini-image-gen",
      description: "使用 gemini-2.0-flash-exp-image-generation 生成图片",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "图片生成提示词"
          }
        },
        required: ["prompt"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const prompt = args.prompt as string;
      const kv = await Deno.openKv();
      const apiKey = await kv.get(["gemini-api-key"]);
      if (!apiKey) {
        return createTextResponse("未设置 API 密钥", true);
      }

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: prompt }
                ]
              }],
              generationConfig: {
                responseModalities: ["Text", "Image"]
              }
            })
          }
        );

        if (!response.ok) {
          throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.text();
        const base64Image = data.match(/"data": "([^"]*)"/)?.[1];

        if (!base64Image) {
          throw new Error("未能从响应中提取图片数据");
        }

        const url = await uploadFile(base64Image, `${generateShortKey()}.png`, prompt);
        return createTextResponse(`![${prompt}](${url})`);
      } catch (error) {
        return createTextResponse(`生成图片失败: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  },
  {
    tool: {
      name: "set-github-token",
      description: "设置 github token",
      inputSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "github token"
          }
        },
        required: ["token"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const token = args.token as string;

      try {
        const kv = await Deno.openKv();
        await kv.set(["github-token"], token);
        return createTextResponse("github token 已设置");
      } catch (error) {
        return createTextResponse(`设置 github token 失败: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  },
  {
    tool: {
      name: "set-gemini-api-key",
      description: "设置 gemini-2.0-flash-exp-image-generation 的 API 密钥",
      inputSchema: {
        type: "object",
        properties: {
          apiKey: {
            type: "string",
            description: "API 密钥"
          }
        },
        required: ["apiKey"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const apiKey = args.apiKey as string;

      try {
        const kv = await Deno.openKv();
        await kv.set(["gemini-api-key"], apiKey);
        return createTextResponse("API 密钥已设置");
      } catch (error) {
        return createTextResponse(`设置 API 密钥失败: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  },
  {
    tool: {
      name: "set-github-repo",
      description: "设置 github repo",
      inputSchema: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "github repo"
          }
        },
        required: ["repo"],
      },
    },
    handler: async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const repo = args.repo as string;

      try {
        const kv = await Deno.openKv();
        await kv.set(["github-repo"], repo);
        return createTextResponse("github repo 已设置");
      } catch (error) {
        return createTextResponse(`设置 github repo 失败: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  }
];

// ==================== 服务器配置 ====================

/**
 * 创建并配置服务器
 * @returns 服务器实例和清理函数
 */
function createServer(): { server: Server; cleanup: () => Promise<void> } {
  // 创建注册表实例
  const toolRegistry = new ToolRegistry();

  // 注册工具
  toolRegistry.registerAll(TOOLS);

  // 创建服务器
  const server = new Server(
    {
      name: "工具服务器",
      version: "1.0.0",
      description: "模块化工具服务器，提供各种实用工具功能"
    },
    {
      capabilities: {
        tools: {
          list: true,
          call: true
        },
      },
    }
  );

  // 设置工具请求处理程序
  server.setRequestHandler(ListToolsRequestSchema, () => {
    return { tools: toolRegistry.getTools() };
  });

  // 设置工具调用处理程序
  server.setRequestHandler(CallToolRequestSchema, (request: CallToolRequest) => {
    return toolRegistry.handleToolCall(request.params.name, request.params.arguments ?? {});
  });

  // 清理函数
  const cleanup = async (): Promise<void> => {
    // 执行必要的清理操作
    console.error("正在清理资源...");
  };

  return { server, cleanup };
}

// ==================== 主程序 ====================

/**
 * 主程序入口
 */
async function main() {
  const { server, cleanup } = createServer();
  const app = express();
  let transport: SSEServerTransport;

  // 添加根路由，返回使用说明页面
  app.get("/", (req, res) => {
    // 获取主机信息，如果没有则默认使用 localhost
    const host = req.headers.host || `localhost:${PORT}`;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = `${protocol}://${host}`;

    // 从 TOOLS 数组生成工具 HTML
    const toolsHtml = TOOLS.map(toolHandler => {
      const { name, description, inputSchema } = toolHandler.tool;

      // 生成参数列表
      let paramsHtml = '';
      if (inputSchema && inputSchema.properties) {
        paramsHtml = '参数:\n';
        for (const [paramName, paramSchema] of Object.entries(inputSchema.properties)) {
          const paramDesc = (paramSchema as { description?: string }).description || '';
          const required = inputSchema.required && inputSchema.required.includes(paramName) ? '' : '（可选）';
          paramsHtml += `- ${paramName}${required}: ${paramDesc}\n`;
        }
      }

      return `
      <div class="tool">
        <h3>${name}</h3>
        <p>${description}</p>
        <pre>${paramsHtml}</pre>
      </div>
      `;
    }).join('');

    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>MCP 工具服务器</title>
      <style>
        body {
          font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
          line-height: 1.6;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          color: #333;
        }
        h1, h2, h3 {
          color: #1a73e8;
        }
        code {
          background-color: #f5f5f5;
          padding: 2px 5px;
          border-radius: 3px;
          font-family: monospace;
        }
        pre {
          background-color: #f5f5f5;
          padding: 15px;
          border-radius: 5px;
          overflow-x: auto;
        }
        .endpoint {
          margin-bottom: 10px;
          padding: 10px;
          background-color: #e8f0fe;
          border-left: 4px solid #1a73e8;
          border-radius: 3px;
        }
        .tool {
          margin-bottom: 20px;
          padding: 15px;
          background-color: #f8f9fa;
          border-radius: 5px;
          border: 1px solid #dadce0;
        }
      </style>
    </head>
    <body>
      <h1>MCP 工具服务器</h1>
      <p>这是一个基于 Model Context Protocol (MCP) 的工具服务器，提供多种实用工具功能。</p>
      
      <h2>服务器端点</h2>
      <div class="endpoint">
        <strong>SSE 端点:</strong> <code>${baseUrl}/sse</code><br>
        <strong>消息端点:</strong> <code>${baseUrl}/message</code>
      </div>
      
      <h2>如何连接</h2>
      <p>在 Cursor 中，您可以通过以下步骤连接到此 MCP 服务器：</p>
      <ol>
        <li>打开 Cursor 设置</li>
        <li>导航到 MCP Servers 部分</li>
        <li>点击 "Add new MCP server"</li>
        <li>输入服务器名称和 SSE 端点 URL: <code>${baseUrl}/sse</code></li>
      </ol>
      
      <h2>可用工具</h2>
      ${toolsHtml}
      
      <h2>使用示例</h2>
      <p>连接到服务器后，您可以在 Cursor 中使用这些工具（工具名会自动加上 mcp__ 前缀）。按如下方式进行验证：</p>
      <pre>你可以使用哪些 mcp 工具</pre>
      <pre>请帮我验证下 mcp__XXX 工具</pre>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  app.get("/sse", async (req, res) => {
    transport = new SSEServerTransport("/message", res);
    await server.connect(transport);

    server.onclose = async () => {
      await cleanup();
      await server.close();
      process.exit(0);
    };
  });

  app.post("/message", async (req, res) => {
    await transport.handlePostMessage(req, res);
  });

  const PORT = Deno.env.get("PORT") || 3001;
  app.listen(Number(PORT));
}

// 启动服务器
await main();