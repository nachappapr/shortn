import { AsyncLocalStorage } from "async_hooks";

const als = new AsyncLocalStorage<{
  requestId: string;
}>();

export default als;
