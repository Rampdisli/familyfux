import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskCard } from '../task-card/task-card';
import { TaskPool } from '../task-pool';

@Component({
  selector: 'app-task-list',
  imports: [RouterLink, TaskCard],
  templateUrl: './task-list.html',
  styleUrl: './task-list.scss',
})
export class TaskList {
  protected readonly pool = inject(TaskPool);
}
