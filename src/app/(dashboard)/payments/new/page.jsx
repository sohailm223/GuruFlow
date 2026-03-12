"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function GlobalAddPayment() {
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];

  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);

  const [form, setForm] = useState({
    projectId: "",
    clientId: "",
    amount: "",
    receivedDate: today,
    entryDate: today,
    notes: "",
    files: [],
  });

  // ✅ FETCH PROJECTS (CORRECT)
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch("/api/projects");
        const data = await res.json();
        setProjects(data);
      } catch (err) {
        console.error("Failed to load projects", err);
      }
    };

    fetchProjects();
  }, []);

  const onProjectSelect = (e) => {
    const projectId = e.target.value;
    const project = projects.find(p => p.id === projectId);

    setSelectedProject(project);
    setForm(prev => ({
      ...prev,
      projectId,
      clientId: project?.assignClient?.id || "",
    }));
  };

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleFileChange = (e) =>
    setForm({ ...form, files: [...e.target.files] });

  const submitPayment = async () => {
    if (!form.projectId || !form.amount) {
      alert("Project and amount are required");
      return;
    }

    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === "files") {
        value.forEach(file => payload.append("files", file));
      } else {
        payload.append(key, value);
      }
    });

    await fetch("/api/payments/create", {
      method: "POST",
      body: payload,
    });

    router.push("/payments");
  };

  return (
    <div className="max-w-xl bg-white p-6 rounded-xl shadow">
      <h1 className="text-xl font-semibold mb-4">Add Payment</h1>

      {/* Project */}
      <label className="text-sm">Project *</label>
      <select
        value={form.projectId}
        onChange={onProjectSelect}
        className="w-full border rounded px-3 py-2 mb-4"
      >
        <option value="">Select project</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>

      {/* Client */}
      <label className="text-sm">Client</label>
      <input
        value={selectedProject?.assignClient?.name || ""}
        disabled
        className="w-full bg-gray-100 border rounded px-3 py-2 mb-4"
      />

      {/* Amount */}
      <label className="text-sm">Amount *</label>
      <input
        type="number"
        name="amount"
        value={form.amount}
        onChange={handleChange}
        className="w-full border rounded px-3 py-2 mb-4"
      />

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-sm">Received Date *</label>
          <input
            type="date"
            name="receivedDate"
            value={form.receivedDate}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm">Entry Date</label>
          <input
            type="date"
            name="entryDate"
            value={form.entryDate}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
          />
        </div>
      </div>

      {/* Notes */}
      <label className="text-sm">Notes</label>
      <textarea
        name="notes"
        value={form.notes}
        onChange={handleChange}
        rows="3"
        className="w-full border rounded px-3 py-2 mb-4"
      />

      {/* Files (future-ready) */}
      <label className="text-sm">Attach File</label>
      <input type="file" multiple onChange={handleFileChange} />

      {/* Actions */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={() => router.back()}
          className="border px-4 py-2 rounded"
        >
          Cancel
        </button>
        <button
          onClick={submitPayment}
          className="bg-black text-white px-4 py-2 rounded"
        >
          Save Payment
        </button>
      </div>
    </div>
  );
}
