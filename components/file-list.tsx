"use client"

import { X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface FileListProps {
  files: File[]
  onRemove: (index: number) => void
  onClear: () => void
}

export function FileList({ files, onRemove, onClear }: FileListProps) {
  if (files.length === 0) return null

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-medium">Selected Files ({files.length})</h3>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear All
          </Button>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {files.map((file, index) => {
            const ext = file.name.split('.').pop()?.toLowerCase() || ''
            const sizeKB = (file.size / 1024).toFixed(2)
            return (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between p-3 bg-muted rounded-md"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">{sizeKB} KB</span>
                    <Badge variant="secondary" className="text-xs">
                      {ext.toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 ml-2"
                  onClick={() => onRemove(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
