import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { toast } from "sonner";

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>Enter your current password and choose a new one.</DialogDescription>
        </DialogHeader>
        <ChangePasswordForm
          onSuccess={() => {
            toast.success("Password updated");
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
