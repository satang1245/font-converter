"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const formats = [
  { id: "ttf", label: "TTF (TrueType Font)" },
  { id: "otf", label: "OTF (OpenType Font)" },
  { id: "woff", label: "WOFF (Web Open Font Format)" },
  { id: "woff2", label: "WOFF2 (Web Open Font Format 2)" },
]

interface FormatSelectorProps {
  selectedFormats: string[]
  onFormatsChange: (formats: string[]) => void
}

export function FormatSelector({ selectedFormats, onFormatsChange }: FormatSelectorProps) {
  const handleFormatToggle = (formatId: string) => {
    if (selectedFormats.includes(formatId)) {
      onFormatsChange(selectedFormats.filter(f => f !== formatId))
    } else {
      onFormatsChange([...selectedFormats, formatId])
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Select formats to convert (multiple selection possible)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {formats.map((format) => (
            <Label
              key={format.id}
              htmlFor={format.id}
              className={cn(
                "flex items-center space-x-3 rounded-md border p-3 cursor-pointer transition-colors",
                selectedFormats.includes(format.id)
                  ? "border-primary bg-muted"
                  : "border-border hover:bg-muted/50"
              )}
            >
              <Checkbox
                id={format.id}
                checked={selectedFormats.includes(format.id)}
                onCheckedChange={() => handleFormatToggle(format.id)}
              />
              <span className={cn(
                "text-sm flex-1",
                selectedFormats.includes(format.id) && "font-semibold"
              )}>
                {format.label}
              </span>
            </Label>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
