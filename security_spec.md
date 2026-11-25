# Security Specification — Auto AI Switch

## 1. Data Invariants
1. **Strict Tenant Isolation**: Every user profile, provider configuration, conversation, message, switch event, research source, and daily usage ledger lives strictly under `/users/{userId}` and carries `userId == request.auth.uid` (or `uid == request.auth.uid` on `/users/{userId}`).
2. **Email Verification Gate**: All authenticated reads and writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Key-Boundary Isolation**: Plaintext external AI provider API keys are never persisted in Firestore; only AES-256-GCM ciphertext (`encryptedKey`, `iv`, `authTag`) and masked hints (`keyHint`) are stored.
4. **Master Gate Integrity**: Messages under `/users/{userId}/conversations/{conversationId}/messages/{messageId}` require the parent conversation document to exist and belong to `request.auth.uid`.
5. **Temporal & Structural Integrity**: All `createdAt` and `updatedAt` timestamps must equal `request.time`. Strings and bounded arrays have strict upper length bounds (`priorityOrder <= 8`, `attachmentNames <= 5`).

## 2. Dirty Dozen Adversarial Payloads (Must Return `PERMISSION_DENIED`)
1. **Cross-Tenant Profile Read**: User B (`uid: "userB"`) attempts `get(/users/userA)`.
2. **User Enumeration List**: Authenticated User A attempts `list(/users)`.
3. **Spoofed Owner on Conversation Create**: User B writes `/users/userB/conversations/c1` with `userId: "userA"`.
4. **Shadow Field Injection on Profile**: User A creates `/users/userA` with an extra shadow field `isAdmin: true`.
5. **Unverified Email Bypass**: User with `email_verified: false` attempts to create `/users/userA/conversations/c1`.
6. **ID Poisoning**: User A writes `/users/userA/conversations/${"x".repeat(500)}` or path with slashes/dots.
7. **Unbounded Array Exhaustion**: User A updates `priorityOrder` with 25 items (`> 8`).
8. **Type Poisoning on Update**: User A updates `/users/userA/providers/openai` setting `totalRequests: "unlimited"`.
9. **Client-Forged Timestamp**: User A creates a message with `createdAt: Timestamp(2099-01-01)` instead of `request.time`.
10. **Immutable Owner Mutation**: User A updates a conversation attempting to change `userId` or `createdAt`.
11. **Orphaned Message Write**: User A creates a message under `/users/userA/conversations/nonexistent/messages/m1`.
12. **Oversized Payload (Denial of Wallet)**: User A creates a source with `extractedText` exceeding `150000` characters.
