"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function SearchTabs() {
  const router = useRouter();
  const [transactionType, setTransactionType] = useState("rent");
  const [location, setLocation] = useState("");

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (transactionType) params.set("transaction_type", transactionType);
    if (location.trim()) params.set("location", location.trim());
    router.push(`/search?${params.toString()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur-md sm:p-6">
      <Tabs
        value={transactionType}
        onValueChange={setTransactionType}
      >
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="rent" className="flex-1">
            Pronájem
          </TabsTrigger>
          <TabsTrigger value="sale" className="flex-1">
            Prodej
          </TabsTrigger>
        </TabsList>

        <TabsContent value={transactionType} className="mt-0">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              placeholder="Město nebo lokalita..."
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
            />
            <Button onClick={handleSearch} size="lg" className="shrink-0">
              <Search className="mr-2 h-4 w-4" />
              Hledat
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
