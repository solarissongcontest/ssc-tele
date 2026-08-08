import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/friend-voting")({
  component: FriendVotingTest,
});

function FriendVotingTest() {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "40px",
        color: "white",
        background: "#02040f",
      }}
    >
      <h1>Friend Voting Route Works</h1>
      <p>If you can see this, the route itself is fine.</p>
    </div>
  );
}
