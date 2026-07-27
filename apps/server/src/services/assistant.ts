import {
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import type { AssistantContext, AssistantHistoryTurn } from "@chi-tieu/shared";

export const ASSISTANT_MAX_TOOL_ROUNDS = 4;
export const ASSISTANT_TIMEOUT_MS = 20_000;

export type AssistantToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface AssistantGenerationInput {
  message: string;
  history: AssistantHistoryTurn[];
  context: AssistantContext;
  systemInstruction: string;
  executeTool: AssistantToolExecutor;
}

export interface AssistantGenerationResult {
  reply: string;
  toolNames: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface AssistantService {
  generate(input: AssistantGenerationInput): Promise<AssistantGenerationResult>;
}

export class AssistantServiceError extends Error {
  constructor(
    readonly code: "assistant_timeout" | "assistant_provider_error" | "assistant_content_blocked",
    message: string,
  ) {
    super(message);
    this.name = "AssistantServiceError";
  }
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const stringSchema = (description: string): Record<string, unknown> => ({
  type: "string",
  description,
});

const numberSchema = (description: string): Record<string, unknown> => ({
  type: "number",
  description,
});

export const ASSISTANT_FUNCTIONS: FunctionDeclaration[] = [
  {
    name: "get_finance_profile",
    description: "Đọc hồ sơ tài chính cơ bản và các năm có dữ liệu. Không chứa thông tin nhận dạng.",
    parametersJsonSchema: objectSchema({}),
  },
  {
    name: "get_expense_config",
    description: "Đọc danh mục thu/chi và tài khoản hiện có để chọn đúng ID trước khi đề xuất giao dịch.",
    parametersJsonSchema: objectSchema({}),
  },
  {
    name: "search_transactions",
    description: "Tìm tối đa 20 giao dịch của người dùng theo khoảng ngày và bộ lọc.",
    parametersJsonSchema: objectSchema({
      from: stringSchema("Ngày bắt đầu YYYY-MM-DD."),
      to: stringSchema("Ngày kết thúc YYYY-MM-DD."),
      type: { type: "string", enum: ["income", "expense"] },
      categoryId: stringSchema("ID danh mục, chỉ dùng sau khi đọc cấu hình."),
      accountId: stringSchema("ID tài khoản, chỉ dùng sau khi đọc cấu hình."),
      query: stringSchema("Từ khóa trong ghi chú."),
    }, ["from", "to"]),
  },
  {
    name: "get_statistics",
    description: "Đọc tổng hợp thu, chi và trích quỹ theo toàn bộ, năm, tháng hoặc khoảng tháng.",
    parametersJsonSchema: objectSchema({
      mode: { type: "string", enum: ["all", "year", "month", "range"] },
      year: { type: "integer", description: "Năm khi mode=year." },
      month: stringSchema("Tháng YYYY-MM khi mode=month."),
      from: stringSchema("Tháng bắt đầu YYYY-MM khi mode=range."),
      to: stringSchema("Tháng kết thúc YYYY-MM khi mode=range."),
    }, ["mode"]),
  },
  {
    name: "get_fund_overview",
    description: "Đọc quỹ cho một tháng. Khi tạo proposal chỉ được dùng ID trong writableSavingFunds hoặc fund có canQuickAllocate=true; các quỹ khác chỉ để tra cứu.",
    parametersJsonSchema: objectSchema({
      year: { type: "integer" },
      month: { type: "integer", minimum: 1, maximum: 12 },
    }, ["year", "month"]),
  },
  {
    name: "get_debt_overview",
    description: "Đọc tổng quan nợ phải trả, phải thu và các kỳ thanh toán.",
    parametersJsonSchema: objectSchema({}),
  },
  {
    name: "propose_finance_batch",
    description: "Tạo một bản xem trước nguyên tử gồm 1-10 khoản thu/chi và trích quỹ. Không ghi dữ liệu. Phải chứa đủ mọi thao tác người dùng yêu cầu và chỉ gọi khi tất cả đều rõ.",
    parametersJsonSchema: objectSchema({
      transactions: {
        type: "array",
        maxItems: 10,
        description: "Các khoản thu/chi, để [] nếu không có.",
        items: objectSchema({
          position: { type: "integer", minimum: 0, description: "Thứ tự xuất hiện trong câu, bắt đầu từ 0." },
          date: stringSchema("Ngày YYYY-MM-DD."),
          type: { type: "string", enum: ["income", "expense"] },
          categoryId: stringSchema("ID danh mục hợp lệ lấy từ get_expense_config."),
          accountId: stringSchema("ID tài khoản hợp lệ; bỏ qua nếu người dùng không nêu."),
          amount: numberSchema("Số tiền VND nguyên dương."),
          note: stringSchema("Ghi chú ngắn mô tả khoản thu/chi."),
        }, ["position", "date", "type", "categoryId", "amount", "note"]),
      },
      fundAllocations: {
        type: "array",
        maxItems: 10,
        description: "Các lần trích quỹ, để [] nếu không có.",
        items: objectSchema({
          position: { type: "integer", minimum: 0, description: "Thứ tự xuất hiện trong câu, bắt đầu từ 0." },
          fundId: stringSchema("ID chỉ lấy từ writableSavingFunds của get_fund_overview."),
          year: { type: "integer" },
          month: { type: "integer", minimum: 1, maximum: 12 },
          operation: { type: "string", enum: ["increment", "set"] },
          amount: numberSchema("Số tiền VND nguyên dương. increment là cộng thêm, set là đặt tổng."),
        }, ["position", "fundId", "year", "month", "operation", "amount"]),
      },
    }, ["transactions", "fundAllocations"]),
  },
];

function statusOf(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  return Number((error as { status?: unknown }).status) || 0;
}

function isTransient(error: unknown): boolean {
  const status = statusOf(error);
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseParts(response: GenerateContentResponse): Part[] {
  return response.candidates?.[0]?.content?.parts ?? [];
}

function isBlocked(response: GenerateContentResponse): boolean {
  if (response.promptFeedback?.blockReason) return true;
  return String(response.candidates?.[0]?.finishReason ?? "") === "SAFETY";
}

interface GeminiAssistantOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  now?: () => number;
  random?: () => number;
}

export function createGeminiAssistantService({
  apiKey,
  model,
  timeoutMs = ASSISTANT_TIMEOUT_MS,
  now = () => Date.now(),
  random = Math.random,
}: GeminiAssistantOptions): AssistantService {
  const client = new GoogleGenAI({ apiKey });

  return {
    async generate(input): Promise<AssistantGenerationResult> {
      const deadline = now() + timeoutMs;
      const contents: Content[] = [
        ...input.history.map((turn): Content => ({
          role: turn.role === "assistant" ? "model" : "user",
          parts: [{ text: turn.text }],
        })),
        { role: "user", parts: [{ text: input.message }] },
      ];
      const toolNames: string[] = [];
      let inputTokens = 0;
      let outputTokens = 0;

      const callModel = async (): Promise<GenerateContentResponse> => {
        let attempt = 0;
        while (true) {
          const remaining = deadline - now();
          if (remaining <= 0) {
            throw new AssistantServiceError("assistant_timeout", "Trợ lý phản hồi quá thời gian cho phép.");
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), remaining);
          try {
            const response = await client.models.generateContent({
              model,
              contents,
              config: {
                systemInstruction: input.systemInstruction,
                temperature: 0.2,
                maxOutputTokens: 3_000,
                abortSignal: controller.signal,
                tools: [{ functionDeclarations: ASSISTANT_FUNCTIONS }],
              },
            });
            inputTokens += response.usageMetadata?.promptTokenCount ?? 0;
            outputTokens += response.usageMetadata?.candidatesTokenCount ?? 0;
            return response;
          } catch (error) {
            if ((error as { name?: string }).name === "AbortError" || deadline - now() <= 0) {
              throw new AssistantServiceError("assistant_timeout", "Trợ lý phản hồi quá thời gian cho phép.");
            }
            if (attempt === 0 && isTransient(error)) {
              attempt += 1;
              await sleep(250 + Math.floor(random() * 250));
              continue;
            }
            throw new AssistantServiceError("assistant_provider_error", "Không thể kết nối dịch vụ trợ lý.");
          } finally {
            clearTimeout(timer);
          }
        }
      };

      for (let round = 0; round < ASSISTANT_MAX_TOOL_ROUNDS; round += 1) {
        const response = await callModel();
        if (isBlocked(response)) {
          throw new AssistantServiceError("assistant_content_blocked", "Nội dung không thể được xử lý an toàn.");
        }
        const calls = response.functionCalls ?? [];
        if (!calls.length) {
          const reply = response.text?.trim();
          if (!reply) {
            throw new AssistantServiceError("assistant_provider_error", "Trợ lý không trả về nội dung hợp lệ.");
          }
          return { reply, toolNames, inputTokens, outputTokens };
        }

        const modelParts = responseParts(response);
        if (modelParts.length) contents.push({ role: "model", parts: modelParts });
        const functionParts: Part[] = [];
        for (const call of calls) {
          const name = call.name ?? "";
          if (!name) continue;
          toolNames.push(name);
          try {
            const output = await input.executeTool(name, call.args ?? {});
            functionParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name,
                response: { output },
              },
            });
          } catch (error) {
            functionParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name,
                response: {
                  error: error instanceof Error ? error.message : "Tool input không hợp lệ.",
                },
              },
            });
          }
        }
        contents.push({ role: "user", parts: functionParts });
      }

      throw new AssistantServiceError(
        "assistant_provider_error",
        "Trợ lý cần quá nhiều bước để hoàn tất yêu cầu.",
      );
    },
  };
}
