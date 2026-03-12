export default function Credentials({ credentials }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Credentials</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {credentials.map((c, i) => (
          <div key={i} className="border p-4 rounded">
            <p className="font-semibold">{c.name}</p>
            <p>Type: {c.type}</p>
            <p>Login: {c.loginUrl}</p>
            <p>Username: {c.useername}</p>
            <p>Password: {c.password}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
