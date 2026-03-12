import { fetchHygraph } from "./hygraph";

/* ---------------- CREATE USER ---------------- */

export async function createUserList({ clerkId, email, name, role }) {
  const data = await fetchHygraph(
    `
    mutation CreateUserList($data: UserListCreateInput!) {
      createUserList(data: $data) {
        id
      }
    }
    `,
    {
      data: {
        clerkId,
        email,
        name,
        role,
        createdAt: new Date().toISOString(),
      },
    }
  );

  return data.createUserList;
}

/* ---------------- GET USER ---------------- */

export async function getUserListByClerkId(clerkId) {
  const data = await fetchHygraph(
    `
    query GetUserList($clerkId: String!) {
      userList(where: { clerkId: $clerkId }) {
        id
        clerkId
        email
        name
        role
      }
    }
    `,
    { clerkId }
  );

  return data.userList;
}

/* ---------------- UPDATE ROLE ---------------- */

export async function updateUserListRole(clerkId, role) {
  const data = await fetchHygraph(
    `
    mutation UpdateUserList($clerkId: String!, $role: Role!) {
      updateUserList(
        where: { clerkId: $clerkId }
        data: { role: $role }
      ) {
        id
        role
      }
    }
    `,
    { clerkId, role }
  );

  return data.updateUserList;
}

/* ---------------- PENDING USERS ---------------- */

export async function getPendingUserLists() {
  const data = await fetchHygraph(
    `
    query {
      userLists(where: { role: GUEST }) {
        id
        clerkId
        email
        name
      }
    }
    `
  );

  return data.userLists;
}
