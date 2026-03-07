// Public media-understanding helpers and types for provider plugins.

export type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  ImageDescriptionRequest,
  ImageDescriptionResult,
  ImagesDescriptionInput,
  ImagesDescriptionRequest,
  MediaUnderstandingProvider,
  VideoDescriptionRequest,
  VideoDescriptionResult,
} from "../media-understanding/types.js";

import type { ImageDescriptionResult } from "../media-understanding/types.js";
export type ImagesDescriptionResult = ImageDescriptionResult;

export {
  describeImageWithModel,
  describeImagesWithModel,
} from "../media-understanding/providers/image.js";
export { transcribeOpenAiCompatibleAudio } from "../media-understanding/providers/openai-compatible-audio.js";
export {
  assertOkOrThrowHttpError,
  normalizeBaseUrl,
  postJsonRequest,
  postTranscriptionRequest,
  requireTranscriptionText,
} from "../media-understanding/providers/shared.js";
