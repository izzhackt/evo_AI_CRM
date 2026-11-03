export function createReplySnippetFormKey(requestId: string): string {
  return `create:${requestId}`;
}

export function replySnippetRowFormKey(
  replySnippetId: string,
  updateRequestId: string,
  archiveRequestId: string,
): string {
  return `snippet:${replySnippetId}:update:${updateRequestId}:archive:${archiveRequestId}`;
}
