import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { ServerEnv } from "./ServerEnv";

export function getOtelResource() {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "terron",
    [ATTR_SERVICE_VERSION]: "1.0.0",
    ...getPromLabels(),
  });
}

export function getPromLabels() {
  const workerId = ServerEnv.workerId();
  return {
    "service.instance.id": ServerEnv.hostname(),
    "terron.environment": ServerEnv.env(),
    "terron.host": ServerEnv.host(),
    "terron.domain": ServerEnv.domain(),
    "terron.subdomain": ServerEnv.subdomain(),
    "terron.component":
      workerId !== undefined ? "Worker " + workerId : "Master",
  };
}
