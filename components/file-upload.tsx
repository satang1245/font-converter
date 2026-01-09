"use client"

import { useCallback, useState } from "react"
import { Upload } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void
}

export function FileUpload({ onFilesSelected }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return
    
    const validFiles: File[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.size > 10 * 1024 * 1024) {
        alert(`${file.name} exceeds 10MB.`)
        continue
      }
      validFiles.push(file)
    }
    if (validFiles.length > 0) {
      onFilesSelected(validFiles)
    }
  }, [onFilesSelected])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files)
    e.target.value = ""
  }, [handleFiles])

  return (
    <Card
      className={cn(
        "border-dashed cursor-pointer transition-colors",
        isDragging && "bg-muted border-primary"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => document.getElementById("file-input")?.click()}
    >
      <CardContent className="flex flex-col items-center justify-center p-12 text-center">
        <Upload className="h-12 w-12 mb-4 text-muted-foreground" />
        <p className="text-lg font-medium mb-2">Click or drag and drop files to upload</p>
        <p className="text-sm text-muted-foreground">
          Supported formats: TTF, OTF, WOFF, WOFF2 <br />
          (max: 10MB per file)
        </p>
        <input
          id="file-input"
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </CardContent>
    </Card>
  )
}
