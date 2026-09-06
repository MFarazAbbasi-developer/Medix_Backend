export interface CurrentUserPayload {
  userId: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}
