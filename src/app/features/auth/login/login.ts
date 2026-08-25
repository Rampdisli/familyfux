import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '../../../core/auth';

type Mode = 'signIn' | 'signUp';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly mode = signal<Mode>('signIn');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly infoMessage = signal<string | null>(null);

  protected toggleMode(): void {
    this.mode.update((mode) => (mode === 'signIn' ? 'signUp' : 'signIn'));
    this.errorMessage.set(null);
    this.infoMessage.set(null);
  }

  protected async submit(): Promise<void> {
    this.errorMessage.set(null);
    this.infoMessage.set(null);
    this.loading.set(true);

    const { error } =
      this.mode() === 'signIn'
        ? await this.auth.signInWithPassword(this.email(), this.password())
        : await this.auth.signUp(this.email(), this.password());

    this.loading.set(false);

    if (error) {
      this.errorMessage.set(error.message);
      return;
    }

    if (this.mode() === 'signUp') {
      this.infoMessage.set('Konto erstellt. Bitte bestätige deine E-Mail-Adresse, um dich anzumelden.');
      return;
    }

    void this.router.navigateByUrl('/dashboard');
  }
}
