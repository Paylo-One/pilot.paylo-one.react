import { afterEach, describe, expect, it } from "vitest";

import { llmEmbeddingModel } from "./llm";

const originalBaseUrl = process.env.LLM_BASE_URL;
const originalEmbeddingModel = process.env.LLM_EMBEDDING_MODEL;

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.LLM_BASE_URL;
  else process.env.LLM_BASE_URL = originalBaseUrl;

  if (originalEmbeddingModel === undefined) {
    delete process.env.LLM_EMBEDDING_MODEL;
  } else {
    process.env.LLM_EMBEDDING_MODEL = originalEmbeddingModel;
  }
});

describe("llmEmbeddingModel", () => {
  it("uses Requesty's provider-prefixed model id on the EU router", () => {
    process.env.LLM_BASE_URL = "https://router.eu.requesty.ai/v1";
    delete process.env.LLM_EMBEDDING_MODEL;

    expect(llmEmbeddingModel()).toBe("openai/text-embedding-3-small");
  });

  it("uses the bare model id for hosted OpenAI", () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_EMBEDDING_MODEL;

    expect(llmEmbeddingModel()).toBe("text-embedding-3-small");
  });

  it("honours an explicit embedding model override", () => {
    process.env.LLM_BASE_URL = "https://router.eu.requesty.ai/v1";
    process.env.LLM_EMBEDDING_MODEL = "provider/custom-embedding-model";

    expect(llmEmbeddingModel()).toBe("provider/custom-embedding-model");
  });
});
