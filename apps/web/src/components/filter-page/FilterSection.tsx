interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
}

export function FilterSection({ title, children }: FilterSectionProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-[#232B3A]">{title}</h3>
      {children}
    </div>
  );
}
