export default function Payments({ payments }) {
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Payments</h2>

      <div className="bg-gray-50 p-4 rounded">
        <p>Total Received: $ {totalPaid}</p>

        <ul className="mt-2 space-y-1">
          {payments.map(p => (
            <li key={p.id}>
              $ {p.amount} — {new Date(p.receivedDate).toDateString()}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
