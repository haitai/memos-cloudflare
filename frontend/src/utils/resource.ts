import { Resource } from "@/types/proto/api/v1/resource_service";

export const getResourceUrl = (resource: Resource) => {
  if (resource.externalLink) {
    return resource.externalLink;
  }

  // 从资源名称中提取UID，格式通常是 "resources/{uid}"
  const uid = resource.name?.split('/').pop() || '';
  
  // 使用后端 API 的基础 URL，而不是前端的 origin
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_BACKEND_URL || 'https://your-worker-name.your-subdomain.workers.dev';
  
  return `${apiBaseUrl}/o/r/${uid}/${resource.filename}`;
};

export const getResourceType = (resource: Resource) => {
  if (isImage(resource.type)) {
    return "image/*";
  } else if (resource.type.startsWith("video")) {
    return "video/*";
  } else if (resource.type.startsWith("audio")) {
    return "audio/*";
  } else if (resource.type.startsWith("text")) {
    return "text/*";
  } else if (resource.type.startsWith("application/epub+zip")) {
    return "application/epub+zip";
  } else if (resource.type.startsWith("application/pdf")) {
    return "application/pdf";
  } else if (resource.type.includes("word")) {
    return "application/msword";
  } else if (resource.type.includes("excel")) {
    return "application/msexcel";
  } else if (resource.type.startsWith("application/zip")) {
    return "application/zip";
  } else if (resource.type.startsWith("application/x-java-archive")) {
    return "application/x-java-archive";
  } else {
    return "application/octet-stream";
  }
};

// isImage returns true if the given mime type is an image.
export const isImage = (t: string) => {
  // Don't show PSDs as images.
  return t.startsWith("image/") && !isPSD(t);
};

const isPSD = (t: string) => {
  return t === "image/vnd.adobe.photoshop" || t === "image/x-photoshop" || t === "image/photoshop";
};
