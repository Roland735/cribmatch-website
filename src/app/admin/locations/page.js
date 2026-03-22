import AdminLocationsClient from "./AdminLocationsClient";

export default function AdminLocationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Location management</h1>
        <p className="mt-2 text-sm text-slate-300">
          Create, update, and remove cities and suburbs used across web and WhatsApp.
        </p>
      </div>
      <AdminLocationsClient />
    </div>
  );
}
