import { btnCls, Card, cn, inputCls, labelCls } from "@/components/ui";

type StaffOption = {
  id: number;
  name: string;
};

export function LeadProfileForm({
  action,
  lead,
  staff,
  labels,
}: {
  action: (form: FormData) => void | Promise<void>;
  lead: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    source: string | null;
    amount: number | null;
    manager_id: number | null;
    target_country: string | null;
    notes: string | null;
  };
  staff: StaffOption[];
  labels: {
    title: string;
    name: string;
    phone: string;
    email: string;
    source: string;
    country: string;
    amount: string;
    manager: string;
    notes: string;
    notAssigned: string;
    save: string;
  };
}) {
  return (
    <Card title={labels.title}>
      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={lead.id} />
        <label className={labelCls}>
          {labels.name}
          <input name="name" defaultValue={lead.name} required className={cn(inputCls, "mt-1")} />
        </label>
        <label className={labelCls}>
          {labels.phone}
          <input name="phone" defaultValue={lead.phone ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
        </label>
        <label className={labelCls}>
          {labels.email}
          <input name="email" defaultValue={lead.email ?? ""} className={cn(inputCls, "mt-1")} />
        </label>
        <label className={labelCls}>
          {labels.source}
          <input name="source" defaultValue={lead.source ?? ""} className={cn(inputCls, "mt-1")} />
        </label>
        <label className={labelCls}>
          {labels.country}
          <input name="target_country" defaultValue={lead.target_country ?? ""} className={cn(inputCls, "mt-1")} />
        </label>
        <label className={labelCls}>
          {labels.amount}
          <input name="amount" type="number" defaultValue={lead.amount ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
        </label>
        <label className={cn(labelCls, "sm:col-span-2")}>
          {labels.manager}
          <select name="manager_id" defaultValue={lead.manager_id ?? ""} className={cn(inputCls, "mt-1")}>
            <option value="">{labels.notAssigned}</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className={cn(labelCls, "sm:col-span-2")}>
          {labels.notes}
          <textarea name="notes" defaultValue={lead.notes ?? ""} rows={4} className={cn(inputCls, "mt-1 h-28 resize-y py-2")} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className={btnCls}>
            {labels.save}
          </button>
        </div>
      </form>
    </Card>
  );
}
